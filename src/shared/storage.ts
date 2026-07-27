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
  const existing = prospects.find(
    (p) => p.profileUrl === prospect.profileUrl || p.id === prospect.id
  );
  if (existing) {
    const merged: Prospect = {
      ...existing,
      ...prospect,
      name: prospect.name || existing.name,
      jobTitle: prospect.jobTitle || existing.jobTitle,
      profilePicture: prospect.profilePicture || existing.profilePicture,
      updatedAt: new Date().toISOString(),
    };
    const updated = prospects.map((p) => (p.id === existing.id ? merged : p));
    await saveProspects(updated);
    return merged;
  }
  prospects.push(prospect);
  await saveProspects(prospects);
  return prospect;
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
