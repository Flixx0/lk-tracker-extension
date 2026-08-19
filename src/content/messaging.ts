import { waitForMessagingList } from "../shared/linkedin-dom";
import { isExtensionContextValid } from "../shared/extension-context";
import { logActivity } from "../shared/log-activity";
import { sendToBackground } from "../shared/messaging";
import { showSyncBanner, hideSyncBanner } from "../shared/sync-banner";
import type { ExtensionMessage, Prospect } from "../shared/types";

const PENDING_MESSAGES_SYNC_KEY = "lkPendingMessagesSync";

let messagingInitialized = false;
let syncRunning = false;

async function isTrackingEnabled(): Promise<boolean> {
  const settings = await sendToBackground<{ trackingEnabled: boolean }>({
    type: "GET_SETTINGS",
  });
  return settings?.trackingEnabled ?? false;
}


function extractProfileUrlFromMessaging(): string | null {
  const selectors = [
    ".msg-thread__link-to-profile[href*='/in/']",
    ".msg-overlay-bubble-header a[href*='/in/']",
    ".msg-entity-lockup a[href*='/in/']",
    ".msg-title-bar a[href*='/in/']",
    ".msg-thread-title a[href*='/in/']",
    ".msg-thread a[href*='/in/']",
    "a[href*='/in/'][data-control-name]",
  ];

  for (const sel of selectors) {
    const link = document.querySelector<HTMLAnchorElement>(sel);
    if (link?.href && /\/in\/[^/?#]+/.test(link.href)) {
      return link.href.split("?")[0];
    }
  }

  if (window.location.pathname.includes("/messaging/thread/")) {
    const profileLink = document.querySelector<HTMLAnchorElement>("a[href*='/in/']");
    if (profileLink?.href && /\/in\/[^/?#]+/.test(profileLink.href)) {
      return profileLink.href.split("?")[0];
    }
  }

  return null;
}

function attachMessageListeners(): void {
  if (!isExtensionContextValid()) return;

  const sendButtons = document.querySelectorAll<HTMLElement>(
    "button[type='submit'], button.msg-form__send-button, button[aria-label*='Send'], button[aria-label*='Envoyer']"
  );

  for (const button of Array.from(sendButtons)) {
    if (button.dataset.lkTrackerBound) continue;
    button.dataset.lkTrackerBound = "true";

    button.addEventListener("click", () => {
      void (async () => {
        if (!(await isTrackingEnabled())) return;

        const profileUrl = extractProfileUrlFromMessaging();
        if (!profileUrl) return;

        setTimeout(async () => {
          const recorded = await sendToBackground<Prospect | null>({
            type: "RECORD_MESSAGE",
            payload: { profileUrl },
          });
          if (!recorded?.followUpDate) return;

          const followUp = new Date(recorded.followUpDate);
          await logActivity(
            `Message enregistré — relance le ${followUp.toLocaleDateString("fr-FR")}`,
            "LK Tracker"
          );
          console.log("[LK Tracker] Message enregistré pour", profileUrl);
        }, 300);
      })();
    });
  }
}


export type MessagesSyncMode = "week" | "all";

async function syncMessages(mode: MessagesSyncMode = "all"): Promise<void> {
  if (window !== window.top) return;
  if (syncRunning) return;
  if (!isExtensionContextValid()) return;

  syncRunning = true;

  const modeLabel = mode === "week" ? "dernière semaine" : "tous les prospects";

  try {
    const settings = await sendToBackground<{ trackingEnabled: boolean }>({
      type: "GET_SETTINGS",
    });
    if (!settings?.trackingEnabled) {
      console.log("[LK Tracker] Sync messages ignorée — tracking désactivé");
      return;
    }

    showSyncBanner(`LK Tracker — Sync messages (${modeLabel})…`);
    await logActivity(`Sync messages (${modeLabel})…`, "LK Tracker", false, true);
    console.log("[LK Tracker] Sync messages via Voyager API, mode:", mode);

    // Attendre que la page /messaging soit chargée (pour que les cookies soient actifs)
    await waitForMessagingList(10000).catch(() => {});

    // Le service worker fait l'appel Voyager API directement (plus fiable que le DOM)
    const result = await sendToBackground<{ updated: number; apiError?: string }>({
      type: "SYNC_MESSAGES",
      payload: { mode },
    });

    if (!result) {
      hideSyncBanner("Sync messages échouée", true);
      await logActivity("Sync messages échouée", "LK Tracker — erreur", true);
      return;
    }

    if (result.apiError) {
      hideSyncBanner(`Erreur API: ${result.apiError}`, true);
      await logActivity(`Sync messages erreur: ${result.apiError}`, "LK Tracker — erreur", true);
      return;
    }

    console.log(`[LK Tracker] ${result.updated} prospects mis à jour (message envoyé)`);

    hideSyncBanner(`✓ Sync messages : ${result.updated} prospect(s) mis à jour`);
    await logActivity(
      `Sync messages : ${result.updated} prospect(s) → message envoyé`,
      "LK Tracker — sync"
    );

    void sendToBackground({
      type: "MESSAGES_SYNC_DONE",
      payload: result,
    });
  } catch (err) {
    hideSyncBanner("Sync messages échouée", true);
    throw err;
  } finally {
    syncRunning = false;
  }
}

async function maybeAutoSyncMessages(): Promise<void> {
  if (!location.pathname.includes("/messaging")) return;

  try {
    const flag = await chrome.storage.local.get(PENDING_MESSAGES_SYNC_KEY);
    const flagValue = flag[PENDING_MESSAGES_SYNC_KEY];
    if (!flagValue) return;
    await chrome.storage.local.remove(PENDING_MESSAGES_SYNC_KEY);

    const mode: MessagesSyncMode =
      typeof flagValue === "object" && flagValue?.mode === "week" ? "week" : "all";
    console.log("[LK Tracker] Auto-sync messages (flag popup), mode:", mode);
    // LinkedIn messaging charge la liste en lazy — laisser plus de temps
    setTimeout(() => {
      syncMessages(mode).catch((err) => console.error("[LK Tracker] syncMessages:", err));
    }, 4000);
  } catch (err) {
    console.error("[LK Tracker] maybeAutoSyncMessages:", err);
  }
}

function initMessagingHandlers(): void {
  attachMessageListeners();
  const observer = new MutationObserver(() => attachMessageListeners());
  observer.observe(document.body, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "TRIGGER_MESSAGES_SYNC") {
    const payload = message.payload as { mode?: MessagesSyncMode } | undefined;
    const mode: MessagesSyncMode = payload?.mode ?? "all";
    syncMessages(mode).catch((err) => console.error("[LK Tracker] syncMessages:", err));
  }
  if (message.type === "SYNC_MESSAGES") {
    // SYNC_MESSAGES avec payload = données depuis service worker, on ignore (pas un trigger)
    if (message.payload) return;
    syncMessages("all").catch((err) => console.error("[LK Tracker] syncMessages:", err));
  }
});

export function initMessaging(): void {
  if (messagingInitialized) {
    maybeAutoSyncMessages().catch((err) =>
      console.error("[LK Tracker] maybeAutoSyncMessages:", err)
    );
    return;
  }
  messagingInitialized = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMessagingHandlers);
  } else {
    initMessagingHandlers();
  }

  maybeAutoSyncMessages().catch((err) =>
    console.error("[LK Tracker] maybeAutoSyncMessages:", err)
  );
  console.log("[LK Tracker] Module messaging actif");
}
