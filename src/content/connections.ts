import {
  collectConnectionsFromPage,
} from "../shared/linkedin-dom";
import { isExtensionContextValid } from "../shared/extension-context";
import { logActivity } from "../shared/log-activity";
import { sendToBackground } from "../shared/messaging";
import type { ExtensionMessage } from "../shared/types";

const PENDING_SYNC_KEY = "lkPendingConnectionsSync";

let syncRunning = false;

async function syncConnections(): Promise<void> {
  if (window !== window.top) return;
  if (syncRunning) return;
  if (!isExtensionContextValid()) return;

  syncRunning = true;

  try {
    const settings = await sendToBackground<{ trackingEnabled: boolean }>({
      type: "GET_SETTINGS",
    });
    if (!settings?.trackingEnabled) {
      console.log("[LK Tracker] Sync ignorée — tracking désactivé");
      return;
    }

    await logActivity("Sync connexions en cours…", "LK Tracker", false, true);
    console.log("[LK Tracker] Début sync connexions…", location.pathname);

    const prospects =
      (await sendToBackground<Array<{ profileUrl: string }>>({ type: "GET_PROSPECTS" })) ?? [];
    const targetUrls = prospects.map((p) => p.profileUrl).filter(Boolean);

    const connections = await collectConnectionsFromPage({
      maxScrolls: 12,
      targetUrls,
    });
    const withTitle = connections.filter((c) => c.jobTitle).length;
    const withChoices = connections.filter((c) => (c.jobTitleCandidates?.length ?? 0) > 0).length;
    console.log(
      `[LK Tracker] ${connections.length} connexions (${withTitle} titre auto, ${withChoices} à choisir)`,
      connections.slice(0, 3).map((c) => ({
        name: c.name,
        jobTitle: c.jobTitle,
        candidates: c.jobTitleCandidates,
      }))
    );

    if (connections.length === 0) {
      await logActivity("Aucune connexion trouvée sur la page", "LK Tracker — sync", true);
      return;
    }

    const result = await sendToBackground<{
      updated: number;
      metaUpdated?: number;
      titlesPending?: number;
      touched?: number;
    }>({
      type: "SYNC_CONNECTIONS",
      payload: connections,
    });

    if (!result) {
      await logActivity("Sync échouée — rafraîchis la page (F5)", "LK Tracker — erreur", true);
      return;
    }

    console.log(
      `[LK Tracker] Sync connexions: ${result.updated} → connecté(s), ${result.metaUpdated ?? 0} photo/titre maj, ${result.titlesPending ?? 0} titres à choisir`
    );

    const meta = result.metaUpdated ?? 0;
    const pending = result.titlesPending ?? 0;
    const statusPart =
      result.updated > 0 ? `${result.updated} → connecté(s)` : "aucun nouveau connecté";
    const metaPart = meta > 0 ? `${meta} photo/titre mis à jour` : null;
    const pendingPart = pending > 0 ? `${pending} titre(s) à choisir dans le popup` : null;

    await logActivity(
      `Sync terminée : ${[statusPart, metaPart, pendingPart].filter(Boolean).join(" · ")}`,
      "LK Tracker — sync"
    );

    void sendToBackground({
      type: "CONNECTIONS_SYNC_DONE",
      payload: result,
    });
  } finally {
    syncRunning = false;
  }
}

async function maybeAutoSync(): Promise<void> {
  if (!location.pathname.includes("connections")) return;

  try {
    const flag = await chrome.storage.local.get(PENDING_SYNC_KEY);
    if (!flag[PENDING_SYNC_KEY]) return;
    await chrome.storage.local.remove(PENDING_SYNC_KEY);
    console.log("[LK Tracker] Auto-sync connexions (flag popup)");
    setTimeout(() => {
      syncConnections().catch((err) => console.error("[LK Tracker] syncConnections:", err));
    }, 2500);
  } catch (err) {
    console.error("[LK Tracker] maybeAutoSync:", err);
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "TRIGGER_CONNECTIONS_SYNC" || message.type === "SYNC_CONNECTIONS") {
    if (message.payload) return;
    syncConnections().catch((err) => console.error("[LK Tracker] syncConnections:", err));
  }
});

export function initConnections(): void {
  console.log("[LK Tracker] Module connexions actif", location.pathname);
  maybeAutoSync().catch((err) => console.error("[LK Tracker] maybeAutoSync:", err));
}
