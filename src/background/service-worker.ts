import type { AppSettings, ExtensionMessage, PendingInvite, Prospect } from "../shared/types";
import { PROSPECT_STATUSES } from "../shared/types";
import {
  addProspect,
  createProspectId,
  deleteProspect,
  findProspectByProfileUrl,
  getProspects,
  getSettings,
  normalizeProfileUrl,
  runMigrationIfNeeded,
  setSettings,
  updateProspect,
} from "../shared/storage";
import { downloadExcel } from "../shared/export";
import { isLikelyConnectionDateText } from "../shared/linkedin-dom";
import { findProspectsInConversations, getLinkedInCsrfToken } from "../shared/linkedin-api";

const PENDING_INVITE_KEY = "pendingInvite";
const PANEL_WINDOW_ID_KEY = "lkPanelWindowId";

// ─── Clic sur l'icône → ouvre directement la fenêtre détachée ────────────────

chrome.action.onClicked.addListener(() => {
  openPanelWindow().catch((err) =>
    console.error("[LK Tracker] openPanelWindow:", err)
  );
});

// ─── Migration au démarrage ───────────────────────────────────────────────────

runMigrationIfNeeded().catch((err) =>
  console.error("[LK Tracker] Migration Supabase:", err)
);

// ─── Fenêtre panel ────────────────────────────────────────────────────────────

async function openPanelWindow(): Promise<{ ok: true; windowId: number }> {
  const stored = await chrome.storage.local.get(PANEL_WINDOW_ID_KEY);
  const existingId = stored[PANEL_WINDOW_ID_KEY] as number | undefined;

  if (existingId) {
    try {
      await chrome.windows.get(existingId);
      await chrome.windows.update(existingId, { focused: true, state: "normal" });
      return { ok: true, windowId: existingId };
    } catch {
      await chrome.storage.local.remove(PANEL_WINDOW_ID_KEY);
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?mode=window"),
    type: "normal",
    width: 440,
    height: 740,
    focused: true,
  });

  if (!win.id) throw new Error("Impossible de créer la fenêtre");

  await chrome.storage.local.set({ [PANEL_WINDOW_ID_KEY]: win.id });
  return { ok: true, windowId: win.id };
}

async function openSidePanel(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.windowId || !chrome.sidePanel?.open) return false;

  try {
    await chrome.sidePanel.setOptions({
      path: "popup.html",
      enabled: true,
    });
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return true;
  } catch (err) {
    console.warn("[LK Tracker] Side panel open failed:", err);
    return false;
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get(PANEL_WINDOW_ID_KEY).then((stored) => {
    if (stored[PANEL_WINDOW_ID_KEY] === windowId) {
      chrome.storage.local.remove(PANEL_WINDOW_ID_KEY);
    }
  });
});

// ─── Notifications ────────────────────────────────────────────────────────────

let lastNotificationAt = 0;
let lastNotificationKey = "";

async function showNotification(title: string, message: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.trackingEnabled) return;

  const now = Date.now();
  const key = `${title}::${message}`;
  if (key === lastNotificationKey && now - lastNotificationAt < 2500) return;
  lastNotificationKey = key;
  lastNotificationAt = now;

  const dataIcon =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  let iconUrl = dataIcon;
  try {
    if (chrome.runtime?.id) {
      iconUrl = chrome.runtime.getURL("icon48.png");
    }
  } catch {
    iconUrl = dataIcon;
  }

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl,
      title,
      message,
      priority: 1,
      silent: false,
    });
  } catch {
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: dataIcon,
        title,
        message,
        priority: 1,
      });
    } catch (err) {
      console.warn("[LK Tracker] Notification:", err);
    }
  }
}

// ─── Pending invite ───────────────────────────────────────────────────────────

async function savePendingInviteStorage(invite: PendingInvite): Promise<void> {
  await chrome.storage.local.set({ [PENDING_INVITE_KEY]: invite });
}

async function getPendingInviteStorage(): Promise<PendingInvite | null> {
  const result = await chrome.storage.local.get(PENDING_INVITE_KEY);
  return result[PENDING_INVITE_KEY] ?? null;
}

async function clearPendingInviteStorage(): Promise<void> {
  await chrome.storage.local.remove(PENDING_INVITE_KEY);
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error("[LK Tracker]", err);
    sendResponse({ error: String(err) });
  });
  return true;
});

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "SHOW_NOTIFICATION": {
      const { title, message: notifMessage } = message.payload as {
        title: string;
        message: string;
      };
      await showNotification(title, notifMessage);
      return { ok: true };
    }

    case "SAVE_PENDING_INVITE":
      await savePendingInviteStorage(message.payload as PendingInvite);
      return { ok: true };

    case "GET_PENDING_INVITE":
      return await getPendingInviteStorage();

    case "CLEAR_PENDING_INVITE":
      await clearPendingInviteStorage();
      return { ok: true };

    case "GET_SETTINGS":
      return await getSettings();

    case "SET_TRACKING": {
      const enabled = (message.payload as { enabled: boolean }).enabled;
      return await setSettings({ trackingEnabled: enabled });
    }

    case "SET_SHEET_CONFIG": {
      const config = message.payload as Partial<AppSettings>;
      return await setSettings(config);
    }

    case "GET_PROSPECTS":
      return await getProspects();

    case "CHECK_PROSPECT_EXISTS": {
      const checkUrl = (message.payload as { profileUrl: string }).profileUrl;
      const found = await findProspectByProfileUrl(checkUrl);
      return { exists: !!found, prospect: found };
    }

    case "OPEN_PANEL_WINDOW":
      await openPanelWindow();
      return { ok: true };

    case "OPEN_SIDE_PANEL": {
      const [sideTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!sideTab) return { ok: false };
      const opened = await openSidePanel(sideTab);
      if (!opened) await openPanelWindow();
      return { ok: opened };
    }

    case "ADD_PROSPECT": {
      const added = await addProspect(message.payload as Prospect);
      return added;
    }

    case "DELETE_PROSPECT": {
      const { id } = message.payload as { id: string };
      const removed = await deleteProspect(id);
      if (!removed) return { ok: false };
      return { ok: true };
    }

    case "UPDATE_PROSPECT": {
      const { id, profileUrl, patch } = message.payload as {
        id?: string;
        profileUrl?: string;
        patch: Partial<Prospect>;
      };
      let prospectId = id;
      if (profileUrl) {
        const found = await findProspectByProfileUrl(profileUrl);
        if (found) prospectId = found.id;
      }
      if (!prospectId) return null;
      return await updateProspect(prospectId, patch);
    }

    case "EXPORT_EXCEL": {
      const prospects = await getProspects();
      await downloadExcel(prospects);
      return { ok: true, count: prospects.length };
    }

    case "RECORD_MESSAGE": {
      const recordPayload = message.payload as { profileUrl: string; firstMessageType?: "video" | "text" };
      return await recordMessage(recordPayload.profileUrl, recordPayload.firstMessageType);
    }

    case "SYNC_MESSAGES": {
      // Payload peut être un tableau de threads (legacy) ou un objet mode
      const payload = message.payload as
        | Array<{ name: string; profileUrl: string; firstMessageType?: "video" | "text" }>
        | { mode?: "week" | "all" }
        | null;

      // Legacy : le content script a déjà fait le travail et envoie les threads
      if (Array.isArray(payload)) {
        let messagesUpdated = 0;
        for (const thread of payload) {
          const recordedMsg = await recordMessage(thread.profileUrl, thread.firstMessageType);
          if (recordedMsg) messagesUpdated++;
        }
        return { updated: messagesUpdated };
      }

      // Nouveau : appel Voyager API depuis le service worker
      const mode = (payload as { mode?: string } | null)?.mode ?? "all";
      return await syncMessagesViaApi(mode as "week" | "all");
    }

    case "SYNC_CONNECTIONS": {
      const connections = message.payload as Array<{
        name: string;
        profileUrl: string;
        jobTitle?: string;
        jobTitleCandidates?: string[];
        profilePicture?: string;
      }>;
      let statusUpdated = 0;
      let metaUpdated = 0;
      let titlesPending = 0;

      const normalizeTitle = (value?: string): string =>
        (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

      const photoIdentity = (url?: string): string => {
        if (!url?.trim()) return "";
        try {
          const parsed = new URL(url.trim());
          return parsed.pathname
            .replace(/shrink_\d+_\d+/gi, "SIZE")
            .replace(/\/$/, "");
        } catch {
          return url.split("?")[0]?.replace(/shrink_\d+_\d+/gi, "SIZE") ?? url;
        }
      };

      const mergeTitleCandidates = (...lists: Array<string[] | undefined>): string[] => {
        const map = new Map<string, string>();
        for (const list of lists) {
          for (const raw of list ?? []) {
            const t = raw.trim().replace(/\s+/g, " ");
            if (t.length < 3) continue;
            if (isLikelyConnectionDateText(t)) continue;
            const key = t.toLowerCase();
            if (!map.has(key)) map.set(key, t);
          }
        }
        return Array.from(map.values()).slice(0, 8);
      };

      for (const conn of connections) {
        const url = normalizeProfileUrl(conn.profileUrl);
        const existing = await findProspectByProfileUrl(url);
        if (!existing) continue;

        const patch: Partial<Prospect> = {};

        const canMarkConnected =
          existing.status === PROSPECT_STATUSES.INVITATION_SENT &&
          !existing.messageSentAt;

        if (canMarkConnected) {
          patch.status = PROSPECT_STATUSES.CONNECTED;
          patch.connectionAcceptedAt =
            existing.connectionAcceptedAt ?? new Date().toISOString();
        }

        const incomingCandidates = mergeTitleCandidates(
          conn.jobTitleCandidates,
          conn.jobTitle ? [conn.jobTitle] : undefined,
          existing.jobTitleCandidates
        );

        const existingTitleBad =
          !existing.jobTitle?.trim() || isLikelyConnectionDateText(existing.jobTitle);

        if (incomingCandidates.length >= 1) {
          const confident =
            incomingCandidates.length === 1 &&
            !!conn.jobTitle &&
            normalizeTitle(conn.jobTitle) === normalizeTitle(incomingCandidates[0]);

          if (confident) {
            if (normalizeTitle(incomingCandidates[0]) !== normalizeTitle(existing.jobTitle)) {
              patch.jobTitle = incomingCandidates[0];
            }
            if ((existing.jobTitleCandidates?.length ?? 0) > 0) {
              patch.jobTitleCandidates = [];
            }
          } else {
            const sameAsExisting =
              existing.jobTitleCandidates &&
              existing.jobTitleCandidates.length === incomingCandidates.length &&
              existing.jobTitleCandidates.every(
                (t, i) => normalizeTitle(t) === normalizeTitle(incomingCandidates[i])
              );
            if (!sameAsExisting) {
              patch.jobTitleCandidates = incomingCandidates;
            }
            if (existingTitleBad && !existing.jobTitle?.trim()) {
              // laisser vide jusqu'au choix
            } else if (existingTitleBad) {
              patch.jobTitle = "";
            }
          }
        } else if (existingTitleBad && existing.jobTitle) {
          patch.jobTitle = "";
        }

        const nextPhoto = conn.profilePicture?.trim();
        if (nextPhoto && photoIdentity(nextPhoto) !== photoIdentity(existing.profilePicture)) {
          patch.profilePicture = nextPhoto;
        }

        const nextName = conn.name?.trim();
        if (
          nextName &&
          nextName.length >= 2 &&
          nextName.toLowerCase() !== (existing.name ?? "").trim().toLowerCase()
        ) {
          if (nextName.length >= existing.name.length || !existing.name.trim()) {
            patch.name = nextName;
          }
        }

        if (Object.keys(patch).length === 0) continue;

        const updated = await updateProspect(existing.id, patch);
        if (!updated) continue;

        if (patch.status) statusUpdated++;
        if (patch.jobTitle || patch.profilePicture || patch.name) metaUpdated++;
        if ((patch.jobTitleCandidates?.length ?? 0) >= 1) titlesPending++;
      }

      return { updated: statusUpdated, metaUpdated, titlesPending };
    }

    // Ces cases existaient pour Google Sheets — gardées vides pour ne pas casser les appels legacy
    case "GOOGLE_CONNECT":
    case "GOOGLE_DISCONNECT":
    case "PULL_SHEET_SYNC":
    case "PUSH_SHEET_SYNC":
      return { ok: false, reason: "Google Sheets désactivé — données migrées vers Supabase" };
  }
}

// ─── Fonctions exportées (utilisées par content scripts) ─────────────────────

/**
 * Sync messages via l'API Voyager LinkedIn (côté service worker).
 * Plus fiable que le DOM scraping — LinkedIn utilise cette API en interne.
 *
 * Le rate-limiting est géré dans linkedin-api.ts (guard 15 min).
 * Ici on ajoute un délai initial variable (2–6s) pour simuler le fait
 * que l'utilisateur vient d'ouvrir /messaging et commence à scroller.
 */
async function syncMessagesViaApi(mode: "week" | "all"): Promise<{ updated: number; apiError?: string }> {
  // Délai initial humanisé avant le premier appel API
  const initialDelay = 2000 + Math.floor(Math.random() * 4000);
  await new Promise((r) => setTimeout(r, initialDelay));
  const csrfToken = await getLinkedInCsrfToken();
  if (!csrfToken) {
    return { updated: 0, apiError: "Pas de session LinkedIn — ouvre linkedin.com d'abord" };
  }

  const allProspects = await getProspects();

  // Filtrer selon le mode
  const cutoff = mode === "week" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0;
  const targetProspects = mode === "week"
    ? allProspects.filter((p) => {
        if (p.messageSentAt && new Date(p.messageSentAt).getTime() >= cutoff) return true;
        if (p.connectionAcceptedAt && new Date(p.connectionAcceptedAt).getTime() >= cutoff) return true;
        if (!p.messageSentAt && new Date(p.createdAt).getTime() >= cutoff) return true;
        return false;
      })
    : allProspects;

  // Extraire les slugs LinkedIn depuis les URLs
  const slugToProspect = new Map<string, Prospect>();
  for (const p of targetProspects) {
    const match = p.profileUrl.match(/\/in\/([^/?#]+)/);
    if (match?.[1]) slugToProspect.set(match[1], p);
  }

  if (slugToProspect.size === 0) return { updated: 0 };

  const targetSlugs = new Set(slugToProspect.keys());
  const maxPages = mode === "week" ? 5 : 15;

  let found: Awaited<ReturnType<typeof findProspectsInConversations>>;
  try {
    found = await findProspectsInConversations(csrfToken, targetSlugs, maxPages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[LK Tracker] Voyager sync error:", err);
    return { updated: 0, apiError: msg };
  }

  let updated = 0;
  for (const conv of found) {
    const recorded = await recordMessage(conv.profileUrl);
    if (recorded) updated++;
  }

  return { updated };
}

export async function recordInvitation(profileData: {
  name: string;
  profileUrl: string;
  profilePicture?: string;
  jobTitle?: string;
}): Promise<Prospect> {
  const settings = await getSettings();
  if (!settings.trackingEnabled) {
    throw new Error("Tracking disabled");
  }

  const profileUrl = normalizeProfileUrl(profileData.profileUrl);
  const now = new Date().toISOString();

  return await addProspect({
    id: createProspectId(profileUrl),
    name: profileData.name,
    profileUrl,
    profilePicture: profileData.profilePicture,
    jobTitle: profileData.jobTitle,
    status: PROSPECT_STATUSES.INVITATION_SENT,
    invitationSentAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

/** Enregistre le premier message uniquement — no-op si déjà messageSentAt. */
export async function recordMessage(
  profileUrl: string,
  firstMessageType?: "video" | "text"
): Promise<Prospect | null> {
  const settings = await getSettings();
  if (!settings.trackingEnabled) return null;

  const normalized = normalizeProfileUrl(profileUrl);
  const existing = await findProspectByProfileUrl(normalized);
  if (!existing || existing.messageSentAt) return null;

  const now = new Date();
  const followUp = new Date(now);
  followUp.setDate(followUp.getDate() + settings.followUpDays);

  return await updateProspect(existing.id, {
    status: PROSPECT_STATUSES.MESSAGE_SENT,
    firstMessageType: firstMessageType ?? undefined,
    messageSentAt: now.toISOString(),
    followUpDate: followUp.toISOString(),
  });
}
