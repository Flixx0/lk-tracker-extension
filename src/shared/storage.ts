import type { AppSettings, Prospect } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { dbDelete, dbPatch, dbSelect, dbUpsert } from "./supabase";

// ─── Settings (chrome.storage.local uniquement — config locale) ───────────────

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

// ─── Mapping Prospect ↔ ligne Supabase ────────────────────────────────────────

interface DbRow {
  id: string;
  name: string;
  profile_url: string;
  profile_picture: string | null;
  job_title: string | null;
  job_title_candidates: string[] | null;
  status: string;
  invitation_sent_at: string | null;
  connection_accepted_at: string | null;
  message_sent_at: string | null;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProspect(row: DbRow): Prospect {
  return {
    id: row.id,
    name: row.name,
    profileUrl: row.profile_url,
    profilePicture: row.profile_picture ?? undefined,
    jobTitle: row.job_title ?? undefined,
    jobTitleCandidates: row.job_title_candidates ?? undefined,
    status: row.status as Prospect["status"],
    invitationSentAt: row.invitation_sent_at ?? undefined,
    connectionAcceptedAt: row.connection_accepted_at ?? undefined,
    messageSentAt: row.message_sent_at ?? undefined,
    followUpDate: row.follow_up_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function prospectToRow(p: Prospect): DbRow {
  return {
    id: p.id,
    name: p.name,
    profile_url: normalizeProfileUrl(p.profileUrl),
    profile_picture: p.profilePicture ?? null,
    job_title: p.jobTitle ?? null,
    job_title_candidates: p.jobTitleCandidates?.length ? p.jobTitleCandidates : null,
    status: p.status,
    invitation_sent_at: p.invitationSentAt ?? null,
    connection_accepted_at: p.connectionAcceptedAt ?? null,
    message_sent_at: p.messageSentAt ?? null,
    follow_up_date: p.followUpDate ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// ─── Cache local (pour éviter un aller-retour réseau à chaque rendu) ──────────

const CACHE_KEY = "prospects_cache";

async function writeCache(prospects: Prospect[]): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: prospects });
}

async function readCache(): Promise<Prospect[] | null> {
  const r = await chrome.storage.local.get(CACHE_KEY);
  const v = r[CACHE_KEY];
  return Array.isArray(v) ? (v as Prospect[]) : null;
}

// ─── API publique ─────────────────────────────────────────────────────────────

export async function getProspects(): Promise<Prospect[]> {
  try {
    const rows = await dbSelect<DbRow>("prospects", { select: "*", order: "updated_at.desc" });
    const prospects = rows.map(rowToProspect);
    await writeCache(prospects);
    return prospects;
  } catch (err) {
    console.warn("[LK Tracker] Supabase getProspects — fallback cache:", err);
    return (await readCache()) ?? [];
  }
}

export async function addProspect(prospect: Prospect): Promise<Prospect> {
  const normalized = normalizeProfileUrl(prospect.profileUrl);
  const row = prospectToRow({ ...prospect, profileUrl: normalized });

  // Upsert : si même profile_url existe déjà, on merge
  const [returned] = await dbUpsert<DbRow>("prospects", row, "profile_url");
  const saved = rowToProspect(returned);
  await _invalidateCache();
  return saved;
}

export async function deleteProspect(id: string): Promise<Prospect | null> {
  // Récupère d'abord pour retourner l'objet supprimé
  const rows = await dbSelect<DbRow>("prospects", { id: `eq.${id}`, select: "*" });
  if (rows.length === 0) return null;
  const prospect = rowToProspect(rows[0]);
  await dbDelete("prospects", "id", id);
  await _invalidateCache();
  return prospect;
}

export async function updateProspect(
  id: string,
  patch: Partial<Prospect>
): Promise<Prospect | null> {
  const now = new Date().toISOString();
  const dbPatchData: Partial<DbRow> = {};

  if (patch.name !== undefined) dbPatchData.name = patch.name;
  if (patch.profileUrl !== undefined) dbPatchData.profile_url = normalizeProfileUrl(patch.profileUrl);
  if (patch.profilePicture !== undefined) dbPatchData.profile_picture = patch.profilePicture ?? null;
  if (patch.jobTitle !== undefined) dbPatchData.job_title = patch.jobTitle ?? null;
  if (patch.jobTitleCandidates !== undefined)
    dbPatchData.job_title_candidates = patch.jobTitleCandidates?.length
      ? patch.jobTitleCandidates
      : null;
  if (patch.status !== undefined) dbPatchData.status = patch.status;
  if (patch.invitationSentAt !== undefined)
    dbPatchData.invitation_sent_at = patch.invitationSentAt ?? null;
  if (patch.connectionAcceptedAt !== undefined)
    dbPatchData.connection_accepted_at = patch.connectionAcceptedAt ?? null;
  if (patch.messageSentAt !== undefined) dbPatchData.message_sent_at = patch.messageSentAt ?? null;
  if (patch.followUpDate !== undefined) dbPatchData.follow_up_date = patch.followUpDate ?? null;
  dbPatchData.updated_at = now;

  const rows = await dbPatch<DbRow>("prospects", "id", id, dbPatchData);
  if (rows.length === 0) return null;
  const updated = rowToProspect(rows[0]);
  await _invalidateCache();
  return updated;
}

export async function findProspectByProfileUrl(url: string): Promise<Prospect | null> {
  const normalized = normalizeProfileUrl(url);
  try {
    const rows = await dbSelect<DbRow>("prospects", {
      profile_url: `eq.${normalized}`,
      select: "*",
      limit: "1",
    });
    return rows.length > 0 ? rowToProspect(rows[0]) : null;
  } catch {
    // Fallback cache
    const cached = await readCache();
    return cached?.find((p) => normalizeProfileUrl(p.profileUrl) === normalized) ?? null;
  }
}

/**
 * Fusionne une liste de prospects (depuis Google Sheets legacy ou autre import)
 * dans Supabase. Préfère les données locales existantes sur les champs texte.
 */
export async function mergeProspectsFromSheet(
  sheetProspects: Prospect[],
  preferStatus: (a: Prospect["status"], b: Prospect["status"]) => Prospect["status"]
): Promise<{ imported: number; updated: number; total: number }> {
  if (sheetProspects.length === 0) return { imported: 0, updated: 0, total: 0 };

  const existing = await getProspects();
  const byUrl = new Map(existing.map((p) => [normalizeProfileUrl(p.profileUrl), p]));

  let imported = 0;
  let updated = 0;
  const toUpsert: DbRow[] = [];

  for (const sheet of sheetProspects) {
    const url = normalizeProfileUrl(sheet.profileUrl);
    const local = byUrl.get(url);

    if (!local) {
      toUpsert.push(prospectToRow({ ...sheet, profileUrl: url }));
      imported++;
      continue;
    }

    const merged: Prospect = {
      ...local,
      name: local.name || sheet.name,
      jobTitle: local.jobTitle || sheet.jobTitle,
      profilePicture: local.profilePicture || sheet.profilePicture,
      status: preferStatus(local.status, sheet.status),
      invitationSentAt: local.invitationSentAt || sheet.invitationSentAt,
      connectionAcceptedAt: local.connectionAcceptedAt || sheet.connectionAcceptedAt,
      messageSentAt: local.messageSentAt || sheet.messageSentAt,
      followUpDate: local.followUpDate || sheet.followUpDate,
      createdAt: local.createdAt || sheet.createdAt,
      updatedAt: new Date().toISOString(),
    };

    const changed =
      merged.status !== local.status ||
      merged.jobTitle !== local.jobTitle ||
      merged.profilePicture !== local.profilePicture ||
      merged.name !== local.name ||
      merged.invitationSentAt !== local.invitationSentAt ||
      merged.connectionAcceptedAt !== local.connectionAcceptedAt ||
      merged.messageSentAt !== local.messageSentAt;

    if (changed) {
      toUpsert.push(prospectToRow(merged));
      updated++;
    }
  }

  if (toUpsert.length > 0) {
    // Upsert par chunks de 100
    for (let i = 0; i < toUpsert.length; i += 100) {
      await dbUpsert<DbRow>("prospects", toUpsert.slice(i, i + 100), "profile_url");
    }
    await _invalidateCache();
  }

  const total = (await getProspects()).length;
  return { imported, updated, total };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Vide le cache local — le prochain getProspects() rechargera depuis Supabase. */
async function _invalidateCache(): Promise<void> {
  await chrome.storage.local.remove(CACHE_KEY);
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

// ─── Migration one-shot chrome.storage → Supabase ─────────────────────────────

const MIGRATION_DONE_KEY = "supabase_migration_done";

/**
 * Appelé une seule fois au démarrage du service worker.
 * Si des prospects existent dans l'ancienne clé `prospects` (chrome.storage),
 * ils sont poussés dans Supabase et la clé locale est ensuite effacée.
 */
export async function runMigrationIfNeeded(): Promise<{
  migrated: number;
  skipped: boolean;
}> {
  const flag = await chrome.storage.local.get(MIGRATION_DONE_KEY);
  if (flag[MIGRATION_DONE_KEY]) return { migrated: 0, skipped: true };

  const old = await chrome.storage.local.get("prospects");
  const legacyProspects = old["prospects"];
  if (!Array.isArray(legacyProspects) || legacyProspects.length === 0) {
    // Rien à migrer — marquer quand même comme fait
    await chrome.storage.local.set({ [MIGRATION_DONE_KEY]: true });
    return { migrated: 0, skipped: false };
  }

  console.log(`[LK Tracker] Migration: ${legacyProspects.length} prospects → Supabase`);

  // Upsert par chunks
  const rows = (legacyProspects as Prospect[]).map(prospectToRow);
  for (let i = 0; i < rows.length; i += 100) {
    await dbUpsert<DbRow>("prospects", rows.slice(i, i + 100), "profile_url");
  }

  // Nettoyer l'ancienne clé et marquer la migration comme faite
  await chrome.storage.local.remove("prospects");
  await chrome.storage.local.set({ [MIGRATION_DONE_KEY]: true });

  console.log(`[LK Tracker] Migration terminée — ${legacyProspects.length} prospects migrés`);
  return { migrated: legacyProspects.length, skipped: false };
}
