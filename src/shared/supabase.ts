/**
 * Client Supabase léger — pas de dépendance npm, juste fetch + clé anon.
 * Utilisable depuis le service worker MV3 et le popup.
 */

const SUPABASE_URL = "https://ckciqikyftecydsqimdx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Z1CxTSdrR3mY9hZU7L0S1w_vGjAn3hD";

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
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

async function request<T>(
  path: string,
  init: RequestInit & { params?: Record<string, string> } = {}
): Promise<T> {
  const { params, ...fetchInit } = init;
  let url = `${SUPABASE_URL}/rest/v1/${path}`;
  if (params && Object.keys(params).length > 0) {
    url += "?" + new URLSearchParams(params).toString();
  }

  const res = await fetch(url, {
    ...fetchInit,
    headers: { ...headers(), ...(fetchInit.headers ?? {}) },
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

  // 204 No Content
  if (res.status === 204) return [] as unknown as T;

  return res.json() as Promise<T>;
}

// ─── Types PostgREST ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** SELECT — retourne un tableau de lignes */
export async function dbSelect<T extends Row>(
  table: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  return request<T[]>(table, { method: "GET", params });
}

/** INSERT — upsert avec onConflict sur la colonne `id` */
export async function dbUpsert<T extends Row>(
  table: string,
  rows: T | T[],
  onConflict = "id"
): Promise<T[]> {
  return request<T[]>(table, {
    method: "POST",
    headers: { Prefer: `resolution=merge-duplicates,return=representation` },
    params: { on_conflict: onConflict },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
}

/** DELETE — filtre par colonne=valeur */
export async function dbDelete(table: string, column: string, value: string): Promise<void> {
  await request<unknown>(table, {
    method: "DELETE",
    params: { [column]: `eq.${value}` },
  });
}

/** PATCH — met à jour les lignes qui matchent column=value */
export async function dbPatch<T extends Row>(
  table: string,
  column: string,
  value: string,
  patch: Partial<T>
): Promise<T[]> {
  return request<T[]>(table, {
    method: "PATCH",
    params: { [column]: `eq.${value}` },
    body: JSON.stringify(patch),
  });
}
