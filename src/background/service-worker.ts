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

const PENDING_INVITE_KEY = "pendingInvite";
const PANEL_WINDOW_ID_KEY = "lkPanelWindowId";

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
      await chrome.windows.update(existingId, {
        focused: true,
        width: 420,
        height: 720,
        state: "normal",
      });
      return { ok: true, windowId: existingId };
    } catch {
      await chrome.storage.local.remove(PANEL_WINDOW_ID_KEY);
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?mode=window"),
    type: "normal",
    width: 420,
    height: 720,
    focused: true,
  });

  if (!win.id) throw new Error("Impossible de créer la fenêtre");

  await chrome.storage.local.set({ [PANEL_WINDOW_ID_KEY]: win.id });
  await chrome.windows.update(win.id, {
    width: 420,
    height: 720,
    state: "normal",
  });
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
      const recordUrl = (message.payload as { profileUrl: string }).profileUrl;
      return await recordMessage(recordUrl);
    }

    case "SYNC_MESSAGES": {
      const messageThreads = message.payload as Array<{ name: string; profileUrl: string }>;
      let messagesUpdated = 0;
      for (const thread of messageThreads) {
        const recordedMsg = await recordMessage(thread.profileUrl);
        if (recordedMsg) messagesUpdated++;
      }
      return { updated: messagesUpdated };
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
export async function recordMessage(profileUrl: string): Promise<Prospect | null> {
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
    messageSentAt: now.toISOString(),
    followUpDate: followUp.toISOString(),
  });
}
