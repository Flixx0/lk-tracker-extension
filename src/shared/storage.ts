import type { AppSettings, Prospect } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const PROSPECTS_KEY = "prospects";
const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] };
}

export async function setSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}

export async function getProspects(): Promise<Prospect[]> {
  const result = await chrome.storage.local.get(PROSPECTS_KEY);
  return result[PROSPECTS_KEY] ?? [];
}

export async function saveProspects(prospects: Prospect[]): Promise<void> {
  await chrome.storage.local.set({ [PROSPECTS_KEY]: prospects });
}

export async function addProspect(prospect: Prospect): Promise<Prospect> {
  const prospects = await getProspects();
  const normalized = normalizeProfileUrl(prospect.profileUrl);
  const existing = prospects.find(
    (p) => normalizeProfileUrl(p.profileUrl) === normalized || p.id === prospect.id
  );
  if (existing) {
    const merged: Prospect = {
      ...existing,
      ...prospect,
      id: existing.id,
      profileUrl: normalizeProfileUrl(prospect.profileUrl || existing.profileUrl),
      name: prospect.name || existing.name,
      jobTitle: prospect.jobTitle || existing.jobTitle,
      profilePicture: prospect.profilePicture || existing.profilePicture,
      invitationSentAt: prospect.invitationSentAt || existing.invitationSentAt,
      connectionAcceptedAt: prospect.connectionAcceptedAt || existing.connectionAcceptedAt,
      messageSentAt: prospect.messageSentAt || existing.messageSentAt,
      followUpDate: prospect.followUpDate || existing.followUpDate,
      createdAt: existing.createdAt || prospect.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const updated = prospects.map((p) => (p.id === existing.id ? merged : p));
    await saveProspects(updated);
    return merged;
  }
  const toAdd: Prospect = {
    ...prospect,
    profileUrl: normalized,
  };
  prospects.push(toAdd);
  await saveProspects(prospects);
  return toAdd;
}

/** Fusionne les prospects du sheet dans le stockage local. */
export async function mergeProspectsFromSheet(
  sheetProspects: Prospect[],
  preferStatus: (a: Prospect["status"], b: Prospect["status"]) => Prospect["status"]
): Promise<{ imported: number; updated: number; total: number }> {
  const local = await getProspects();
  const byUrl = new Map(local.map((p) => [normalizeProfileUrl(p.profileUrl), p]));

  let imported = 0;
  let updated = 0;

  for (const sheet of sheetProspects) {
    const url = normalizeProfileUrl(sheet.profileUrl);
    const existing = byUrl.get(url);

    if (!existing) {
      byUrl.set(url, { ...sheet, profileUrl: url });
      imported++;
      continue;
    }

    const merged: Prospect = {
      ...existing,
      name: existing.name || sheet.name,
      jobTitle: existing.jobTitle || sheet.jobTitle,
      profilePicture: existing.profilePicture || sheet.profilePicture,
      status: preferStatus(existing.status, sheet.status),
      invitationSentAt: existing.invitationSentAt || sheet.invitationSentAt,
      connectionAcceptedAt: existing.connectionAcceptedAt || sheet.connectionAcceptedAt,
      messageSentAt: existing.messageSentAt || sheet.messageSentAt,
      followUpDate: existing.followUpDate || sheet.followUpDate,
      createdAt: existing.createdAt || sheet.createdAt,
      updatedAt: new Date().toISOString(),
    };

    const changed =
      merged.status !== existing.status ||
      merged.jobTitle !== existing.jobTitle ||
      merged.profilePicture !== existing.profilePicture ||
      merged.name !== existing.name;

    if (changed) {
      byUrl.set(url, merged);
      updated++;
    }
  }

  const mergedList = Array.from(byUrl.values());
  await saveProspects(mergedList);
  return { imported, updated, total: mergedList.length };
}

export async function deleteProspect(id: string): Promise<Prospect | null> {
  const prospects = await getProspects();
  const index = prospects.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const [removed] = prospects.splice(index, 1);
  await saveProspects(prospects);
  return removed;
}

export async function updateProspect(
  id: string,
  patch: Partial<Prospect>
): Promise<Prospect | null> {
  const prospects = await getProspects();
  const index = prospects.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const updated = {
    ...prospects[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  prospects[index] = updated;
  await saveProspects(prospects);
  return updated;
}

export async function findProspectByProfileUrl(url: string): Promise<Prospect | null> {
  const normalized = normalizeProfileUrl(url);
  const prospects = await getProspects();
  return prospects.find((p) => normalizeProfileUrl(p.profileUrl) === normalized) ?? null;
}

export function normalizeProfileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/in\/([^/]+)/);
    if (match) return `https://www.linkedin.com/in/${match[1]}`;
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

export function createProspectId(profileUrl: string): string {
  const normalized = normalizeProfileUrl(profileUrl);
  const slug = normalized.split("/in/")[1] ?? crypto.randomUUID();
  return slug.replace(/[^a-zA-Z0-9_-]/g, "_");
}
