import type { Prospect, ProspectStatus } from "./types";
import { STATUS_LABELS } from "./types";
import { createProspectId, normalizeProfileUrl } from "./storage";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export const SHEET_HEADERS = [
  "ID",
  "Nom",
  "Lien profil",
  "Poste",
  "Photo",
  "Statut",
  "Invitation envoyée",
  "Connexion acceptée",
  "Message envoyé",
  "Date relance",
  "Créé le",
  "Mis à jour le",
];

const STATUS_FROM_LABEL: Record<string, ProspectStatus> = Object.fromEntries(
  Object.entries(STATUS_LABELS).map(([key, label]) => [label.toLowerCase(), key as ProspectStatus])
) as Record<string, ProspectStatus>;

const STATUS_RANK: Record<ProspectStatus, number> = {
  invitation_envoyee: 1,
  connecte: 2,
  message_envoye: 3,
  relance_a_faire: 3,
};

function parseStatus(value: string | undefined): ProspectStatus {
  if (!value) return "invitation_envoyee";
  const trimmed = value.trim();
  if (trimmed in STATUS_RANK) return trimmed as ProspectStatus;
  const fromLabel = STATUS_FROM_LABEL[trimmed.toLowerCase()];
  if (fromLabel) return fromLabel;
  return "invitation_envoyee";
}

function cell(row: string[], index: number): string {
  return row[index]?.trim() ?? "";
}

export function rowToProspect(row: string[]): Prospect | null {
  const profileUrlRaw = cell(row, 2);
  if (!profileUrlRaw || !profileUrlRaw.includes("/in/")) return null;

  const profileUrl = normalizeProfileUrl(profileUrlRaw);
  const now = new Date().toISOString();
  const id = cell(row, 0) || createProspectId(profileUrl);
  const name = cell(row, 1) || profileUrl.split("/in/")[1] || "Inconnu";

  return {
    id,
    name,
    profileUrl,
    jobTitle: cell(row, 3) || undefined,
    profilePicture: cell(row, 4) || undefined,
    status: parseStatus(cell(row, 5)),
    invitationSentAt: cell(row, 6) || undefined,
    connectionAcceptedAt: cell(row, 7) || undefined,
    messageSentAt: cell(row, 8) || undefined,
    followUpDate: cell(row, 9) || undefined,
    createdAt: cell(row, 10) || now,
    updatedAt: cell(row, 11) || now,
  };
}

export function preferStatus(a: ProspectStatus, b: ProspectStatus): ProspectStatus {
  return (STATUS_RANK[a] ?? 0) >= (STATUS_RANK[b] ?? 0) ? a : b;
}

export function extractSpreadsheetId(urlOrId: string): string {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return urlOrId.trim();
}

/** Quote l'onglet pour l'API (ex. "Feuille 1" → 'Feuille 1'!A1:L1) */
export function formatSheetRange(tabName: string, a1Range: string): string {
  const escaped = tabName.replace(/'/g, "''");
  return `'${escaped}'!${a1Range}`;
}

const GOOGLE_TOKEN_KEY = "googleOAuthAccessToken";
const GOOGLE_TOKEN_EXPIRY_KEY = "googleOAuthTokenExpiry";

interface ManifestOAuth2 {
  client_id?: string;
  web_client_id?: string;
  scopes?: string[];
}

function getManifestOAuth2(): ManifestOAuth2 {
  return (chrome.runtime.getManifest().oauth2 ?? {}) as ManifestOAuth2;
}

/** URI de redirection à enregistrer dans Google Cloud (type Web application). */
export function getOAuthRedirectUrl(): string {
  return chrome.identity.getRedirectURL();
}

async function getCachedGoogleToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get([GOOGLE_TOKEN_KEY, GOOGLE_TOKEN_EXPIRY_KEY]);
  const token = stored[GOOGLE_TOKEN_KEY] as string | undefined;
  const expiry = stored[GOOGLE_TOKEN_EXPIRY_KEY] as number | undefined;
  if (!token || !expiry) return null;
  if (Date.now() > expiry - 60_000) return null;
  return token;
}

async function cacheGoogleToken(token: string, expiresInSeconds = 3600): Promise<void> {
  await chrome.storage.local.set({
    [GOOGLE_TOKEN_KEY]: token,
    [GOOGLE_TOKEN_EXPIRY_KEY]: Date.now() + expiresInSeconds * 1000,
  });
}

async function clearCachedGoogleToken(): Promise<void> {
  await chrome.storage.local.remove([GOOGLE_TOKEN_KEY, GOOGLE_TOKEN_EXPIRY_KEY]);
}

function shouldUseWebAuthFlow(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("invalid_request") ||
    msg.includes("custom uri scheme") ||
    msg.includes("chrome apps") ||
    msg.includes("oauth2 not granted") ||
    msg.includes("did not approve") ||
    msg.includes("user cancelled") ||
    msg.includes("canceled")
  );
}

function prefersWebAuthFlow(): boolean {
  return Boolean(getManifestOAuth2().web_client_id?.trim());
}

async function getAuthTokenViaIdentity(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? "Token Google introuvable"));
        return;
      }
      resolve(token);
    });
  });
}

async function getAuthTokenViaWebAuthFlow(interactive: boolean): Promise<string> {
  const oauth2 = getManifestOAuth2();
  const clientId = oauth2.web_client_id;
  if (!clientId) {
    throw new Error(
      "OAuth Arc/Brave : crée un client « Web application » dans Google Cloud, ajoute l'URI de redirection affichée dans les paramètres, puis renseigne oauth2.web_client_id dans manifest.json"
    );
  }

  const redirectUri = getOAuthRedirectUrl();
  const scopes = (oauth2.scopes ?? ["https://www.googleapis.com/auth/spreadsheets"]).join(" ");

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&prompt=consent`;

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (url) => {
      if (chrome.runtime.lastError || !url) {
        const errMsg = chrome.runtime.lastError?.message ?? "Connexion Google annulée";
        reject(
          new Error(
            `${errMsg}. Vérifie que l'URI de redirection est bien enregistrée dans Google Cloud : ${redirectUri}`
          )
        );
        return;
      }
      resolve(url);
    });
  });

  const params = new URLSearchParams(new URL(responseUrl).hash.replace(/^#/, ""));
  const token = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") ?? "3600");

  if (!token) {
    const error = params.get("error_description") ?? params.get("error");
    throw new Error(error ?? "Token absent dans la réponse OAuth");
  }

  await cacheGoogleToken(token, expiresIn);
  return token;
}

export async function getGoogleAuthToken(interactive = true): Promise<string> {
  const cached = await getCachedGoogleToken();
  if (cached) return cached;

  // Si web_client_id est configuré (Arc/Brave), ne pas appeler getAuthToken
  // qui ouvre une popup invalide avant le vrai flux OAuth.
  if (prefersWebAuthFlow()) {
    return getAuthTokenViaWebAuthFlow(interactive);
  }

  try {
    const token = await getAuthTokenViaIdentity(interactive);
    await cacheGoogleToken(token, 3600);
    return token;
  } catch (err) {
    if (!shouldUseWebAuthFlow(err)) throw err;
    return getAuthTokenViaWebAuthFlow(interactive);
  }
}

export async function revokeGoogleAuthToken(): Promise<void> {
  const cached = await getCachedGoogleToken();
  const identityToken = await getAuthTokenViaIdentity(false).catch(() => null);
  const token = cached ?? identityToken;

  if (token) {
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
    chrome.identity.removeCachedAuthToken({ token }, () => {});
  }

  await clearCachedGoogleToken();
}

function prospectToRow(prospect: Prospect): string[] {
  return [
    prospect.id,
    prospect.name,
    prospect.profileUrl,
    prospect.jobTitle ?? "",
    prospect.profilePicture ?? "",
    STATUS_LABELS[prospect.status] ?? prospect.status,
    prospect.invitationSentAt ?? "",
    prospect.connectionAcceptedAt ?? "",
    prospect.messageSentAt ?? "",
    prospect.followUpDate ?? "",
    prospect.createdAt,
    prospect.updatedAt,
  ];
}

async function sheetsFetch(
  token: string,
  spreadsheetId: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${SHEETS_API}/${spreadsheetId}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sheets API ${response.status}: ${text}`);
  }
  return response;
}

export async function listSheetTabNames(
  token: string,
  spreadsheetId: string
): Promise<string[]> {
  const res = await sheetsFetch(
    token,
    spreadsheetId,
    "?fields=sheets.properties.title"
  );
  const data = await res.json();
  return (data.sheets ?? []).map(
    (sheet: { properties?: { title?: string } }) => sheet.properties?.title ?? ""
  ).filter(Boolean);
}

export async function resolveTabName(
  token: string,
  spreadsheetId: string,
  preferred: string
): Promise<string> {
  const titles = await listSheetTabNames(token, spreadsheetId);
  if (titles.length === 0) return preferred;

  if (titles.includes(preferred)) return preferred;

  const lower = preferred.toLowerCase();
  const caseMatch = titles.find((t) => t.toLowerCase() === lower);
  if (caseMatch) return caseMatch;

  // FR : "Feuille 1" vs "Sheet1"
  if (preferred === "Sheet1") {
    const feuille = titles.find((t) => /^feuille\s*1$/i.test(t));
    if (feuille) return feuille;
  }

  return titles[0];
}

export async function ensureHeaders(
  token: string,
  spreadsheetId: string,
  tabName: string
): Promise<void> {
  const range = formatSheetRange(tabName, "A1:L1");
  const res = await sheetsFetch(
    token,
    spreadsheetId,
    `/values/${encodeURIComponent(range)}`
  );
  const data = await res.json();
  if (data.values?.[0]?.[0] === "ID") return;

  await sheetsFetch(
    token,
    spreadsheetId,
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [SHEET_HEADERS] }),
    }
  );
}

export async function findRowIndex(
  token: string,
  spreadsheetId: string,
  tabName: string,
  profileUrl: string
): Promise<number | null> {
  const range = formatSheetRange(tabName, "C:C");
  const res = await sheetsFetch(
    token,
    spreadsheetId,
    `/values/${encodeURIComponent(range)}`
  );
  const data = await res.json();
  const normalized = normalizeProfileUrl(profileUrl);
  const values = data.values as string[][] | undefined;
  if (!values) return null;

  for (let i = 0; i < values.length; i++) {
    const cell = values[i][0];
    if (cell && normalizeProfileUrl(cell) === normalized) {
      return i + 1;
    }
  }
  return null;
}

export async function upsertProspect(
  token: string,
  spreadsheetId: string,
  tabName: string,
  prospect: Prospect
): Promise<void> {
  await ensureHeaders(token, spreadsheetId, tabName);
  const row = prospectToRow(prospect);
  const existingRow = await findRowIndex(token, spreadsheetId, tabName, prospect.profileUrl);

  if (existingRow) {
    const range = formatSheetRange(tabName, `A${existingRow}:L${existingRow}`);
    await sheetsFetch(
      token,
      spreadsheetId,
      `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({ values: [row] }),
      }
    );
  } else {
    const range = formatSheetRange(tabName, "A:L");
    await sheetsFetch(
      token,
      spreadsheetId,
      `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ values: [row] }),
      }
    );
  }
}

/** Lit tous les prospects du Google Sheet (lignes de données A2:L). */
export async function fetchProspectsFromSheet(
  token: string,
  spreadsheetId: string,
  tabName: string
): Promise<Prospect[]> {
  await ensureHeaders(token, spreadsheetId, tabName);
  const range = formatSheetRange(tabName, "A2:L");
  const res = await sheetsFetch(
    token,
    spreadsheetId,
    `/values/${encodeURIComponent(range)}`
  );
  const data = await res.json();
  const values = (data.values as string[][] | undefined) ?? [];

  const prospects: Prospect[] = [];
  for (const row of values) {
    const prospect = rowToProspect(row);
    if (prospect) prospects.push(prospect);
  }
  return prospects;
}

export async function testSheetAccess(
  token: string,
  spreadsheetId: string,
  tabName: string
): Promise<{ title: string; tabName: string }> {
  const res = await sheetsFetch(token, spreadsheetId, "?fields=properties.title");
  const data = await res.json();
  const resolvedTab = await resolveTabName(token, spreadsheetId, tabName);
  await ensureHeaders(token, spreadsheetId, resolvedTab);
  return { title: data.properties?.title ?? "Sheet", tabName: resolvedTab };
}
