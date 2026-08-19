/**
 * Client LinkedIn Voyager API (API interne non-officielle).
 *
 * LinkedIn utilise cette API pour charger sa propre messagerie.
 * On l'appelle depuis le service worker avec credentials:include
 * pour réutiliser les cookies de session existants.
 *
 * Pas de clé API nécessaire — juste le CSRF token dans les headers.
 *
 * Mesures anti-détection :
 * - Délais inter-pages variables (1.5–4s), simulant un humain qui lit les messages
 * - pageSize variable (16–20) pour éviter les patterns réguliers
 * - Headers x-li-track avec timezone et offset réels du navigateur
 * - Pas de rafale : une seule sync toutes les MIN_INTERVAL_MS
 */

const BASE = "https://www.linkedin.com/voyager/api";

// Intervalle minimum entre deux syncs complètes (15 minutes)
const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;
let lastSyncAt = 0;

/** Délai humanisé entre chaque page paginée (1.5s à 4s) */
async function humanPageDelay(): Promise<void> {
  const ms = 1500 + Math.floor(Math.random() * 2500);
  await new Promise((r) => setTimeout(r, ms));
}

/** Jitter court (200–800ms) pour simuler un traitement humain */
async function jitter(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 600);
  await new Promise((r) => setTimeout(r, ms));
}

// Headers requis par LinkedIn pour les appels Voyager.
// On reprend exactement ce que le navigateur envoie quand l'utilisateur charge /messaging.
function voyagerHeaders(csrfToken: string): HeadersInit {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Europe/Paris";
  const tzOffset = -new Date().getTimezoneOffset() / 60;

  return {
    "accept": "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "csrf-token": csrfToken,
    "x-li-lang": "fr_FR",
    "x-li-page-instance": `urn:li:page:messaging_index;${crypto.randomUUID()}`,
    "x-restli-protocol-version": "2.0.0",
    "x-li-track": JSON.stringify({
      clientVersion: "1.13.18",
      mpVersion: "1.13.18",
      osName: "web",
      timezoneOffset: tzOffset,
      timezone: tz,
      appTokens: {},
      model: "",
    }),
  };
}

export class LinkedInApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "LinkedInApiError";
  }
}

/**
 * Récupère le token CSRF depuis les cookies LinkedIn.
 * Le cookie s'appelle "JSESSIONID" et sa valeur est le token CSRF (entre guillemets).
 */
export async function getLinkedInCsrfToken(): Promise<string | null> {
  try {
    const cookies = await chrome.cookies.getAll({ domain: ".linkedin.com", name: "JSESSIONID" });
    if (cookies.length === 0) return null;
    // La valeur est entre guillemets ex: "ajax:1234567890"
    return cookies[0].value.replace(/^"|"$/g, "");
  } catch {
    return null;
  }
}

async function voyagerFetch<T>(path: string, csrfToken: string, params?: Record<string, string>): Promise<T> {
  let url = `${BASE}${path}`;
  if (params && Object.keys(params).length > 0) {
    url += "?" + new URLSearchParams(params).toString();
  }

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: voyagerHeaders(csrfToken),
  });

  if (!res.ok) {
    throw new LinkedInApiError(res.status, `LinkedIn API ${res.status} — ${path}`);
  }

  return res.json() as Promise<T>;
}

// ─── Types Voyager messaging ──────────────────────────────────────────────────

interface VoyagerConversation {
  entityUrn: string;
  conversationParticipants?: VoyagerParticipant[];
  read?: boolean;
  lastActivityAt?: number;
}

interface VoyagerParticipant {
  "com.linkedin.voyager.messaging.MessagingMember"?: {
    miniProfile?: VoyagerMiniProfile;
  };
}

interface VoyagerMiniProfile {
  publicIdentifier?: string;
  firstName?: string;
  lastName?: string;
  occupation?: string;
}

interface VoyagerConversationsResponse {
  elements?: VoyagerConversation[];
  paging?: { count: number; start: number; total: number };
}

// ─── API publique ─────────────────────────────────────────────────────────────

export interface ConversationParticipant {
  profileUrl: string;
  name: string;
  slug: string;
}

/**
 * Récupère les conversations de messagerie via l'API Voyager.
 * Retourne uniquement les conversations 1-à-1 (pas les groupes).
 *
 * @param csrfToken  token CSRF LinkedIn (cookie JSESSIONID)
 * @param start      offset pour la pagination
 * @param count      nombre de conversations à récupérer
 */
export async function fetchMessagingConversations(
  csrfToken: string,
  start = 0,
  count = 20
): Promise<ConversationParticipant[]> {
  const data = await voyagerFetch<VoyagerConversationsResponse>(
    "/messaging/conversations",
    csrfToken,
    {
      keyVersion: "LEGACY_INBOX",
      start: String(start),
      count: String(count),
    }
  );

  const results: ConversationParticipant[] = [];

  for (const conv of data.elements ?? []) {
    const participants = conv.conversationParticipants ?? [];

    // Ignorer les conversations de groupe (plus d'un participant)
    if (participants.length !== 1) continue;

    const member = participants[0]?.["com.linkedin.voyager.messaging.MessagingMember"];
    const profile = member?.miniProfile;
    if (!profile?.publicIdentifier) continue;

    const slug = profile.publicIdentifier;
    const firstName = profile.firstName ?? "";
    const lastName = profile.lastName ?? "";
    const name = `${firstName} ${lastName}`.trim();
    if (!name) continue;

    results.push({
      slug,
      profileUrl: `https://www.linkedin.com/in/${slug}`,
      name,
    });
  }

  return results;
}

/**
 * Récupère toutes les conversations qui correspondent aux prospects cibles.
 * Pagine tant qu'il y a des résultats ou que tous les targets sont trouvés.
 *
 * Anti-ban :
 * - Délai humain (1.5–4s) entre chaque page
 * - pageSize légèrement variable (16–20) pour éviter les patterns réguliers
 * - Guard : refuse de s'exécuter si la dernière sync date de moins de 15 min
 * - Arrêt anticipé dès que tous les prospects sont trouvés
 *
 * @param csrfToken     token CSRF LinkedIn
 * @param targetSlugs   slugs des prospects à trouver (ex: "jean-dupont")
 * @param maxPages      nombre max de pages à paginer
 */
export async function findProspectsInConversations(
  csrfToken: string,
  targetSlugs: Set<string>,
  maxPages = 10
): Promise<ConversationParticipant[]> {
  // Guard : pas de rafale — minimum 15 min entre deux syncs
  const now = Date.now();
  if (now - lastSyncAt < MIN_SYNC_INTERVAL_MS) {
    const waitMin = Math.ceil((MIN_SYNC_INTERVAL_MS - (now - lastSyncAt)) / 60000);
    console.log(`[LK Tracker] Sync trop fréquente — réessaie dans ${waitMin} min`);
    return [];
  }
  lastSyncAt = now;

  const results: ConversationParticipant[] = [];
  const found = new Set<string>();

  // Petite pause initiale : comme si l'humain venait d'ouvrir la messagerie
  await jitter();

  for (let page = 0; page < maxPages; page++) {
    // pageSize légèrement variable (16–20)
    const pageSize = 16 + Math.floor(Math.random() * 5);

    let conversations: ConversationParticipant[];

    try {
      conversations = await fetchMessagingConversations(csrfToken, page * 20, pageSize);
    } catch (err) {
      console.error("[LK Tracker] Voyager API erreur:", err);
      break;
    }

    if (conversations.length === 0) break;

    for (const conv of conversations) {
      if (targetSlugs.has(conv.slug) && !found.has(conv.slug)) {
        found.add(conv.slug);
        results.push(conv);
      }
    }

    // Arrêt anticipé si on a trouvé tous les targets
    if (found.size >= targetSlugs.size) break;

    // Arrêt si la page est incomplète (fin de la liste)
    if (conversations.length < pageSize) break;

    // Délai humain entre les pages : l'utilisateur prend le temps de lire
    await humanPageDelay();
  }

  console.log(`[LK Tracker] Voyager API: ${results.length}/${targetSlugs.size} prospects trouvés`);
  return results;
}
