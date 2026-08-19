import type { DbRow, FirstMessageType, Prospect, ProspectPatch } from "./types";

function parseMessageType(value: string | null | undefined): FirstMessageType | undefined {
  return value === "video" || value === "text" ? value : undefined;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase n’est pas configuré. Ajoute SUPABASE_URL et SUPABASE_ANON_KEY dans .env.local (ou les variables Vercel)."
    );
  }
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}

function headers(extra?: HeadersInit): HeadersInit {
  const { key } = requireConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

export class SupabaseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "SupabaseError";
  }
}

async function request<T>(path: string, init: RequestInit & { params?: Record<string, string> } = {}): Promise<T> {
  const { url } = requireConfig();
  const { params, ...fetchInit } = init;
  let target = `${url}/rest/v1/${path}`;
  if (params && Object.keys(params).length > 0) {
    target += `?${new URLSearchParams(params).toString()}`;
  }

  const res = await fetch(target, {
    ...fetchInit,
    headers: { ...headers(), ...(fetchInit.headers ?? {}) },
    cache: "no-store",
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const msg =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new SupabaseError(res.status, msg, body);
  }

  if (res.status === 204) return [] as unknown as T;
  return res.json() as Promise<T>;
}

export function rowToProspect(row: DbRow): Prospect {
  return {
    id: row.id,
    name: row.name,
    profileUrl: row.profile_url,
    profilePicture: row.profile_picture ?? undefined,
    jobTitle: row.job_title ?? undefined,
    jobTitleCandidates: row.job_title_candidates ?? undefined,
    status: row.status as Prospect["status"],
    firstMessageType: parseMessageType(row.first_message_type),
    invitationSentAt: row.invitation_sent_at ?? undefined,
    connectionAcceptedAt: row.connection_accepted_at ?? undefined,
    messageSentAt: row.message_sent_at ?? undefined,
    followUpDate: row.follow_up_date ?? undefined,
    followUpSentAt: row.follow_up_sent_at ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUnknownColumnError(err: unknown, column: string): boolean {
  return err instanceof SupabaseError && err.message.toLowerCase().includes(column);
}

export async function fetchAllProspects(): Promise<Prospect[]> {
  const pageSize = 1000;
  const all: Prospect[] = [];
  let offset = 0;

  while (true) {
    const rows = await request<DbRow[]>("prospects", {
      method: "GET",
      params: {
        select: "*",
        order: "updated_at.desc",
        limit: String(pageSize),
        offset: String(offset),
      },
    });
    all.push(...rows.map(rowToProspect));
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

export async function patchProspect(id: string, patch: ProspectPatch): Promise<Prospect> {
  const dbPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.jobTitle !== undefined) dbPatch.job_title = patch.jobTitle;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.firstMessageType !== undefined) dbPatch.first_message_type = patch.firstMessageType;
  if (patch.invitationSentAt !== undefined) dbPatch.invitation_sent_at = patch.invitationSentAt;
  if (patch.connectionAcceptedAt !== undefined)
    dbPatch.connection_accepted_at = patch.connectionAcceptedAt;
  if (patch.messageSentAt !== undefined) dbPatch.message_sent_at = patch.messageSentAt;
  if (patch.followUpDate !== undefined) dbPatch.follow_up_date = patch.followUpDate;
  if (patch.followUpSentAt !== undefined) dbPatch.follow_up_sent_at = patch.followUpSentAt;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;

  const send = (body: Record<string, unknown>) =>
    request<DbRow[]>("prospects", {
      method: "PATCH",
      params: { id: `eq.${id}` },
      body: JSON.stringify(body),
    });

  const optionalColumns = ["follow_up_sent_at", "first_message_type", "notes"];
  let body: Record<string, unknown> = dbPatch;
  let rows: DbRow[] | undefined;

  for (let i = 0; i < optionalColumns.length + 1; i++) {
    try {
      rows = await send(body);
      break;
    } catch (err) {
      const unknown = optionalColumns.find((col) => col in body && isUnknownColumnError(err, col));
      if (!unknown) throw err;
      const { [unknown]: _ignored, ...rest } = body;
      body = rest;
    }
  }

  if (!rows || rows.length === 0) {
    throw new SupabaseError(404, "Prospect introuvable");
  }
  return rowToProspect(rows[0]);
}

export async function deleteProspect(id: string): Promise<void> {
  await request("prospects", {
    method: "DELETE",
    params: { id: `eq.${id}` },
  });
}
