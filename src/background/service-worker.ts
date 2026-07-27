import type { AppSettings, ExtensionMessage, PendingInvite, Prospect } from "../shared/types";
import { PROSPECT_STATUSES } from "../shared/types";
import {
  addProspect,
  createProspectId,
  findProspectByProfileUrl,
  getProspects,
  getSettings,
  normalizeProfileUrl,
  setSettings,
  updateProspect,
} from "../shared/storage";
import { downloadExcel } from "../shared/export";
import {
  extractSpreadsheetId,
  getGoogleAuthToken,
  resolveTabName,
  revokeGoogleAuthToken,
  testSheetAccess,
  upsertProspect,
} from "../shared/sheets";

const PENDING_INVITE_KEY = "pendingInvite";

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

  const token = await getGoogleAuthToken(false);
  const tabName = await resolveTabName(token, settings.spreadsheetId, settings.sheetTabName);
  await upsertProspect(token, settings.spreadsheetId, tabName, prospect);
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
      const token = await getGoogleAuthToken(true);
      const sheetInfo = await testSheetAccess(token, spreadsheetId, requestedTab);
      await setSettings({
        spreadsheetId,
        sheetTabName: sheetInfo.tabName,
        sheetsSyncEnabled: true,
        googleConnected: true,
      });
      const allProspects = await getProspects();
      for (const prospect of allProspects) {
        await upsertProspect(token, spreadsheetId, sheetInfo.tabName, prospect);
      }
      return {
        ok: true,
        title: sheetInfo.title,
        tabName: sheetInfo.tabName,
        synced: allProspects.length,
      };

    case "GOOGLE_DISCONNECT":
      await revokeGoogleAuthToken();
      return await setSettings({
        sheetsSyncEnabled: false,
        googleConnected: false,
      });

    case "GET_PROSPECTS":
      return await getProspects();

    case "ADD_PROSPECT":
      const added = await addProspect(message.payload as Prospect);
      await syncProspectToSheet(added).catch((err) =>
        console.error("[LK Tracker] Sync sheet:", err)
      );
      return added;

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

    case "SYNC_CONNECTIONS":
      const connections = message.payload as Array<{ name: string; profileUrl: string }>;
      let updatedCount = 0;
      for (const conn of connections) {
        const url = normalizeProfileUrl(conn.profileUrl);
        const existing = await findProspectByProfileUrl(url);
        if (existing && existing.status === PROSPECT_STATUSES.INVITATION_SENT) {
          const connected = await updateProspect(existing.id, {
            status: PROSPECT_STATUSES.CONNECTED,
            connectionAcceptedAt: new Date().toISOString(),
          });
          if (connected) {
            await syncProspectToSheet(connected).catch((err) =>
              console.error("[LK Tracker] Sync sheet:", err)
            );
            updatedCount++;
          }
        }
      }
      return { updated: updatedCount };
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

export async function recordMessage(profileUrl: string): Promise<Prospect | null> {
  const settings = await getSettings();
  if (!settings.trackingEnabled) return null;

  const normalized = normalizeProfileUrl(profileUrl);
  const existing = await findProspectByProfileUrl(normalized);
  if (!existing) return null;

  const now = new Date();
  const followUp = new Date(now);
  followUp.setDate(followUp.getDate() + settings.followUpDays);

  return await updateProspect(existing.id, {
    status: PROSPECT_STATUSES.MESSAGE_SENT,
    messageSentAt: now.toISOString(),
    followUpDate: followUp.toISOString(),
  });
}
