import {
  collectMessagingParticipantsForSync,
  parseMessagingConversationsFromPage,
  waitForMessagingList,
} from "../shared/linkedin-dom";
import { isExtensionContextValid } from "../shared/extension-context";
import { logActivity } from "../shared/log-activity";
import { sendToBackground } from "../shared/messaging";
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

function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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

function matchProspectsByConversationNames(
  prospects: Prospect[],
  conversations: Array<{ name: string; profileUrl?: string }>
): Array<{ name: string; profileUrl: string }> {
  const byName = new Map<string, Prospect>();
  for (const p of prospects) {
    byName.set(normalizePersonName(p.name), p);
  }

  const matched: Array<{ name: string; profileUrl: string }> = [];
  const seen = new Set<string>();

  for (const conv of conversations) {
    if (conv.profileUrl) {
      if (seen.has(conv.profileUrl)) continue;
      seen.add(conv.profileUrl);
      matched.push({ name: conv.name, profileUrl: conv.profileUrl });
      continue;
    }

    const prospect = byName.get(normalizePersonName(conv.name));
    if (!prospect) continue;
    if (seen.has(prospect.profileUrl)) continue;
    seen.add(prospect.profileUrl);
    matched.push({ name: prospect.name, profileUrl: prospect.profileUrl });
  }

  return matched;
}

async function syncMessages(): Promise<void> {
  if (window !== window.top) return;
  if (syncRunning) return;
  if (!isExtensionContextValid()) return;

  syncRunning = true;

  try {
    const settings = await sendToBackground<{ trackingEnabled: boolean }>({
      type: "GET_SETTINGS",
    });
    if (!settings?.trackingEnabled) {
      console.log("[LK Tracker] Sync messages ignorée — tracking désactivé");
      return;
    }

    await logActivity("Sync messages en cours…", "LK Tracker", false, true);
    console.log("[LK Tracker] Début sync messages…", location.pathname);

    const listReady = await waitForMessagingList(18000);
    if (!listReady) {
      console.warn("[LK Tracker] Liste messages introuvable dans le DOM");
      await logActivity(
        "Aucune conversation trouvée — ouvre /messaging et réessaie",
        "LK Tracker — sync",
        true
      );
      return;
    }

    const prospects =
      (await sendToBackground<Prospect[]>({ type: "GET_PROSPECTS" })) ?? [];
    const prospectNameSet = new Set(
      prospects.map((p) => normalizePersonName(p.name))
    );

    // Collecte : scroll + match noms + ouverture threads non matchés (rythme humain)
    const fromDom = await collectMessagingParticipantsForSync({
      maxThreadOpens: 12,
      maxScrolls: 14,
      shouldOpenThread: (name) => !prospectNameSet.has(normalizePersonName(name)),
    });
    console.log(`[LK Tracker] ${fromDom.length} profils via DOM/threads`);

    const named = parseMessagingConversationsFromPage();
    const fromNames = matchProspectsByConversationNames(prospects, named);
    console.log(
      `[LK Tracker] ${named.length} convos parsées, ${fromNames.length} match nom`
    );

    const byUrl = new Map<string, { name: string; profileUrl: string }>();
    for (const item of [...fromDom, ...fromNames]) {
      byUrl.set(item.profileUrl, item);
    }
    // Ne garder que les prospects déjà en base
    const prospectUrls = new Set(prospects.map((p) => p.profileUrl));
    const threads = Array.from(byUrl.values()).filter((t) => {
      const normalized = t.profileUrl.replace(/\/$/, "");
      return (
        prospectUrls.has(t.profileUrl) ||
        prospectUrls.has(normalized) ||
        prospects.some(
          (p) =>
            p.profileUrl.includes(`/in/${t.profileUrl.split("/in/")[1]}`) ||
            normalizePersonName(p.name) === normalizePersonName(t.name)
        )
      );
    });
    console.log(`[LK Tracker] ${threads.length} conversations uniques à sync`);

    if (threads.length === 0 && named.length === 0 && fromDom.length === 0) {
      console.warn("[LK Tracker] Debug messaging DOM:", {
        path: location.pathname,
        listItems: document.querySelectorAll(
          ".msg-conversation-listitem, a[href*='/messaging/thread/']"
        ).length,
        inLinks: document.querySelectorAll("a[href*='/in/']").length,
        namedConversations: named.length,
      });
      await logActivity("Aucune conversation trouvée sur la page", "LK Tracker — sync", true);
      return;
    }

    if (threads.length === 0) {
      await logActivity(
        `${named.length || fromDom.length} convos vues, 0 prospect en base à mettre à jour`,
        "LK Tracker — sync"
      );
      void sendToBackground({
        type: "MESSAGES_SYNC_DONE",
        payload: { updated: 0 },
      });
      return;
    }

    const result = await sendToBackground<{ updated: number }>({
      type: "SYNC_MESSAGES",
      payload: threads,
    });

    if (!result) {
      await logActivity("Sync messages échouée — rafraîchis la page (F5)", "LK Tracker — erreur", true);
      return;
    }

    console.log(`[LK Tracker] ${result.updated} prospects mis à jour (message envoyé)`);

    await logActivity(
      `Sync messages : ${result.updated} prospect(s) → message envoyé`,
      "LK Tracker — sync"
    );

    void sendToBackground({
      type: "MESSAGES_SYNC_DONE",
      payload: result,
    });
  } finally {
    syncRunning = false;
  }
}

async function maybeAutoSyncMessages(): Promise<void> {
  if (!location.pathname.includes("/messaging")) return;

  try {
    const flag = await chrome.storage.local.get(PENDING_MESSAGES_SYNC_KEY);
    if (!flag[PENDING_MESSAGES_SYNC_KEY]) return;
    await chrome.storage.local.remove(PENDING_MESSAGES_SYNC_KEY);
    console.log("[LK Tracker] Auto-sync messages (flag popup)");
    // LinkedIn messaging charge la liste en lazy — laisser plus de temps
    setTimeout(() => {
      syncMessages().catch((err) => console.error("[LK Tracker] syncMessages:", err));
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
  if (message.type === "TRIGGER_MESSAGES_SYNC" || message.type === "SYNC_MESSAGES") {
    if (message.payload) return;
    syncMessages().catch((err) => console.error("[LK Tracker] syncMessages:", err));
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
