import type { AppSettings, ExtensionMessage, PendingInvite, Prospect } from "../shared/types";
import { PROSPECT_STATUSES } from "../shared/types";
import {
  addProspect,
  createProspectId,
  deleteProspect,
  findProspectByProfileUrl,
  getProspects,
  getSettings,
  mergeProspectsFromSheet,
  normalizeProfileUrl,
  setSettings,
  updateProspect,
} from "../shared/storage";
import { downloadExcel } from "../shared/export";
import {
  extractSpreadsheetId,
  fetchProspectsFromSheet,
  getGoogleAuthToken,
  hasCachedGoogleToken,
  preferStatus,
  resolveTabName,
  revokeGoogleAuthToken,
  testSheetAccess,
  upsertProspect,
  upsertProspects,
  deleteProspectFromSheet,
  withGoogleSheetsToken,
} from "../shared/sheets";
import { isLikelyConnectionDateText } from "../shared/linkedin-dom";

const PENDING_INVITE_KEY = "pendingInvite";
const PANEL_WINDOW_ID_KEY = "lkPanelWindowId";

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

let lastNotificationAt = 0;
let lastNotificationKey = "";

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

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error("[LK Tracker]", err);
    sendResponse({ error: String(err) });
  });
  return true;
});

async function syncProspectToSheet(prospect: Prospect): Promise<void> {
  const settings = await getSettings();
  if (!settings.sheetsSyncEnabled || !settings.spreadsheetId) return;

  await withGoogleSheetsToken(async (token) => {
    const tabName = await resolveTabName(
      token,
      settings.spreadsheetId!,
      settings.sheetTabName
    );
    await upsertProspect(token, settings.spreadsheetId!, tabName, prospect);
  }, false);
}

async function syncProspectDeletionFromSheet(
  profileUrl: string
): Promise<"skipped" | "deleted" | "not_found"> {
  const settings = await getSettings();
  if (!settings.sheetsSyncEnabled || !settings.spreadsheetId) return "skipped";

  return withGoogleSheetsToken(async (token) => {
    const tabName = await resolveTabName(
      token,
      settings.spreadsheetId!,
      settings.sheetTabName
    );
    const deleted = await deleteProspectFromSheet(
      token,
      settings.spreadsheetId!,
      tabName,
      profileUrl
    );
    return deleted ? "deleted" : "not_found";
  }, false);
}

let lastSheetPullAt = 0;
const SHEET_PULL_COOLDOWN_MS = 60_000;

async function pullAndMergeFromSheet(
  force = false,
  interactiveAuth = false
): Promise<{
  imported: number;
  updated: number;
  total: number;
  sheetCount: number;
}> {
  const settings = await getSettings();
  if (!settings.googleConnected || !settings.spreadsheetId) {
    throw new Error("Google Sheet non connecté");
  }

  const now = Date.now();
  if (!force && now - lastSheetPullAt < SHEET_PULL_COOLDOWN_MS) {
    const local = await getProspects();
    return { imported: 0, updated: 0, total: local.length, sheetCount: -1 };
  }

  return withGoogleSheetsToken(async (token) => {
    const tabName = await resolveTabName(
      token,
      settings.spreadsheetId!,
      settings.sheetTabName
    );
    const sheetProspects = await fetchProspectsFromSheet(
      token,
      settings.spreadsheetId!,
      tabName
    );
    const result = await mergeProspectsFromSheet(sheetProspects, preferStatus);
    lastSheetPullAt = Date.now();
    return { ...result, sheetCount: sheetProspects.length };
  }, interactiveAuth);
}

/** Sync complète : sheet → local puis local → sheet. */
async function syncSheetBidirectional(interactiveAuth = true): Promise<{
  imported: number;
  updated: number;
  total: number;
  sheetCount: number;
  pushed: number;
  sheetUpdated: number;
  sheetAppended: number;
}> {
  const settings = await getSettings();
  if (!settings.googleConnected || !settings.spreadsheetId) {
    throw new Error("Google Sheet non connecté");
  }

  return withGoogleSheetsToken(async (token) => {
    const spreadsheetId = settings.spreadsheetId!;
    const tabName = await resolveTabName(token, spreadsheetId, settings.sheetTabName);

    const sheetProspects = await fetchProspectsFromSheet(token, spreadsheetId, tabName);
    const mergeResult = await mergeProspectsFromSheet(sheetProspects, preferStatus);
    lastSheetPullAt = Date.now();

    const allProspects = await getProspects();
    const pushResult = await upsertProspects(token, spreadsheetId, tabName, allProspects);

    return {
      ...mergeResult,
      sheetCount: sheetProspects.length,
      pushed: allProspects.length,
      sheetUpdated: pushResult.updated,
      sheetAppended: pushResult.appended,
    };
  }, interactiveAuth);
}

async function pushAllProspectsToSheet(interactiveAuth = false): Promise<number> {
  const settings = await getSettings();
  if (!settings.sheetsSyncEnabled || !settings.spreadsheetId) return 0;

  return withGoogleSheetsToken(async (token) => {
    const tabName = await resolveTabName(
      token,
      settings.spreadsheetId!,
      settings.sheetTabName
    );
    const allProspects = await getProspects();
    await upsertProspects(token, settings.spreadsheetId!, tabName, allProspects);
    return allProspects.length;
  }, interactiveAuth);
}

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

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "SHOW_NOTIFICATION":
      const { title, message: notifMessage } = message.payload as {
        title: string;
        message: string;
      };
      await showNotification(title, notifMessage);
      return { ok: true };

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

    case "SET_TRACKING":
      const enabled = (message.payload as { enabled: boolean }).enabled;
      return await setSettings({ trackingEnabled: enabled });

    case "SET_SHEET_CONFIG":
      const config = message.payload as Partial<AppSettings>;
      if (config.spreadsheetId) {
        config.spreadsheetId = extractSpreadsheetId(config.spreadsheetId);
      }
      return await setSettings(config);

    case "GOOGLE_CONNECT":
      const connectPayload = message.payload as {
        spreadsheetId: string;
        sheetTabName?: string;
      };
      const spreadsheetId = extractSpreadsheetId(connectPayload.spreadsheetId);
      const requestedTab = connectPayload.sheetTabName ?? "Sheet1";
      const token = await getGoogleAuthToken(true, { forceConsent: true });
      const sheetInfo = await testSheetAccess(token, spreadsheetId, requestedTab);
      await setSettings({
        spreadsheetId,
        sheetTabName: sheetInfo.tabName,
        sheetsSyncEnabled: true,
        googleConnected: true,
      });
      // Sync bidirectionnelle initiale
      const connectSync = await syncSheetBidirectional(false);
      return {
        ok: true,
        title: sheetInfo.title,
        tabName: sheetInfo.tabName,
        synced: connectSync.pushed,
        imported: connectSync.imported,
        updated: connectSync.updated,
        sheetCount: connectSync.sheetCount,
      };

    case "GOOGLE_DISCONNECT":
      await revokeGoogleAuthToken();
      return await setSettings({
        sheetsSyncEnabled: false,
        googleConnected: false,
      });

    case "PULL_SHEET_SYNC": {
      const pullPayload = (message.payload as {
        mode?: "full" | "pull";
        interactive?: boolean;
      } | null) ?? {};
      const mode = pullPayload.mode ?? "full";
      const interactive = pullPayload.interactive ?? mode === "full";
      if (mode === "pull") {
        return await pullAndMergeFromSheet(true, interactive);
      }
      return await syncSheetBidirectional(interactive);
    }

    case "PUSH_SHEET_SYNC":
      const pushed = await pushAllProspectsToSheet(true);
      return { ok: true, synced: pushed };

    case "GET_PROSPECTS":
      return await getProspects();

    case "CHECK_PROSPECT_EXISTS":
      const checkUrl = (message.payload as { profileUrl: string }).profileUrl;
      let found = await findProspectByProfileUrl(checkUrl);
      if (!found) {
        // Si connecté au sheet, re-synchronise (cooldown 60s) pour détecter les déjà contactés
        const settings = await getSettings();
        if (
          settings.googleConnected &&
          settings.spreadsheetId &&
          (await hasCachedGoogleToken())
        ) {
          try {
            await pullAndMergeFromSheet(false);
            found = await findProspectByProfileUrl(checkUrl);
          } catch (err) {
            console.warn("[LK Tracker] Pull sheet on check:", err);
          }
        }
      }
      return { exists: !!found, prospect: found };

    case "OPEN_PANEL_WINDOW":
      await openPanelWindow();
      return { ok: true };

    case "OPEN_SIDE_PANEL":
      const [sideTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!sideTab) return { ok: false };
      const opened = await openSidePanel(sideTab);
      if (!opened) await openPanelWindow();
      return { ok: opened };

    case "ADD_PROSPECT":
      const added = await addProspect(message.payload as Prospect);
      await syncProspectToSheet(added).catch((err) =>
        console.error("[LK Tracker] Sync sheet:", err)
      );
      return added;

    case "DELETE_PROSPECT": {
      const { id } = message.payload as { id: string };
      const removed = await deleteProspect(id);
      if (!removed) return { ok: false };

      let sheetSync: "skipped" | "deleted" | "not_found" | "error" = "skipped";
      let sheetError: string | undefined;
      try {
        sheetSync = await syncProspectDeletionFromSheet(removed.profileUrl);
      } catch (err) {
        sheetSync = "error";
        sheetError = err instanceof Error ? err.message : String(err);
        console.error("[LK Tracker] Delete sheet:", err);
      }

      return { ok: true, sheetSync, sheetError };
    }

    case "UPDATE_PROSPECT":
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
      const updated = await updateProspect(prospectId, patch);
      if (updated) {
        await syncProspectToSheet(updated).catch((err) =>
          console.error("[LK Tracker] Sync sheet:", err)
        );
      }
      return updated;

    case "EXPORT_EXCEL":
      const prospects = await getProspects();
      await downloadExcel(prospects);
      return { ok: true, count: prospects.length };

    case "RECORD_MESSAGE":
      const recordUrl = (message.payload as { profileUrl: string }).profileUrl;
      const recorded = await recordMessage(recordUrl);
      if (recorded) {
        await syncProspectToSheet(recorded).catch((err) =>
          console.error("[LK Tracker] Sync sheet:", err)
        );
      }
      return recorded;

    case "SYNC_MESSAGES": {
      const messageThreads = message.payload as Array<{ name: string; profileUrl: string }>;
      let messagesUpdated = 0;
      for (const thread of messageThreads) {
        const recordedMsg = await recordMessage(thread.profileUrl);
        if (recordedMsg) {
          messagesUpdated++;
        }
      }
      // Un seul push sheet à la fin — évite N popups OAuth
      if (messagesUpdated > 0) {
        await pushAllProspectsToSheet(false).catch((err) =>
          console.error("[LK Tracker] Sync sheet messages:", err)
        );
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
            // Ambigu ou non sûr → choix sur la card (même 1 candidat)
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

      const touched = statusUpdated + metaUpdated + titlesPending;
      if (touched > 0) {
        await pushAllProspectsToSheet(false).catch((err) =>
          console.error("[LK Tracker] Sync sheet connexions:", err)
        );
      }
      return { updated: statusUpdated, metaUpdated, titlesPending, touched };
    }
  }
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
