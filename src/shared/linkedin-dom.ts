/** Sélecteurs et helpers LinkedIn — l'UI change souvent */
export function getProfileSlugFromPath(): string | null {
  const match = window.location.pathname.match(/\/in\/([^/]+)/);
  return match?.[1] ?? null;
}

export function isProfilePage(): boolean {
  return getProfileSlugFromPath() !== null;
}

export function getCanonicalProfileUrl(): string | null {
  const slug = getProfileSlugFromPath();
  if (!slug) return null;
  return `https://www.linkedin.com/in/${slug}`;
}

/** Profil en page, page invitation, ou modale */
export function getVanityNameFromUrl(): string | null {
  if (!location.pathname.includes("custom-invite")) return null;
  return new URLSearchParams(location.search).get("vanityName");
}

export function isCustomInvitePage(): boolean {
  return location.pathname.includes("custom-invite");
}

export function parseNameFromInviteLabel(label: string): string | null {
  const match = label.match(/Inviter (.+?) à rejoindre/i);
  return match?.[1]?.trim() ?? null;
}

export function extractVanityFromConnectElement(el: HTMLElement): string | null {
  const anchor = (
    el.closest("a[href*='custom-invite']") ??
    (el instanceof HTMLAnchorElement && el.href.includes("custom-invite") ? el : null)
  ) as HTMLAnchorElement | null;
  if (!anchor?.href) return null;
  try {
    return new URL(anchor.href).searchParams.get("vanityName");
  } catch {
    return null;
  }
}

export function findActiveProfileUrl(): string | null {
  const vanity = getVanityNameFromUrl();
  if (vanity) return `https://www.linkedin.com/in/${vanity}`;

  const fromUrl = getCanonicalProfileUrl();
  if (fromUrl) return fromUrl;

  // Modales uniquement — pas le feed entier (évite les faux profils)
  for (const dialog of Array.from(
    document.querySelectorAll('[role="dialog"], .artdeco-modal')
  )) {
    for (const link of Array.from(dialog.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']"))) {
      const href = link.href?.split("?")[0];
      const match = href?.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (match) return `https://www.linkedin.com/in/${match[1]}`;
    }
  }

  return null;
}

export function getElementLabel(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label")?.trim() ?? "";
  const title = el.getAttribute("title")?.trim() ?? "";

  const spanTexts = Array.from(el.querySelectorAll("span"))
    .map((s) => s.textContent?.trim())
    .filter(Boolean);
  const spanLabel = spanTexts.join(" ").trim();

  if (aria) return aria;
  if (spanLabel && spanLabel.length <= 100) return spanLabel;
  if (title) return title;

  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  if (text.length <= 100) return text;
  return aria || spanLabel || text.slice(0, 100);
}

export function collectLabelsFromElement(el: HTMLElement): string[] {
  const labels = new Set<string>();

  const aria = el.getAttribute("aria-label")?.trim();
  const title = el.getAttribute("title")?.trim();
  const componentKey = el.getAttribute("componentkey");
  if (aria) labels.add(aria);
  if (title) labels.add(title);
  if (componentKey) labels.add(componentKey);

  // Texte direct uniquement (évite de lire toute la carte du feed)
  const ownText = Array.from(el.childNodes)
    .map((n) => n.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  if (ownText && ownText.length <= 60) labels.add(ownText);

  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "P" || child.tagName === "SPAN") {
      const t = child.textContent?.trim();
      if (t && t.length <= 60) labels.add(t);
    }
    for (const nested of Array.from(child.querySelectorAll("p, span"))) {
      const t = nested.textContent?.trim();
      if (t && t.length <= 60) labels.add(t);
    }
  }

  return Array.from(labels);
}

/** Lien direct « Se connecter » → /preload/custom-invite/?vanityName=... */
export function findConnectInviteAnchor(target: HTMLElement): HTMLElement | null {
  return target.closest(
    'a[href*="custom-invite"][componentkey*="Connect"], a[href*="custom-invite"][aria-label*="Inviter"], a[href*="custom-invite"][aria-label*="Invite"]'
  );
}

/** Remonte le DOM depuis le clic — LinkedIn utilise des <div>/<a> sans role="button" */
export function findActionFromClick(target: HTMLElement): {
  element: HTMLElement;
  labels: string[];
} | null {
  const inviteAnchor = findConnectInviteAnchor(target);
  if (inviteAnchor) {
    return { element: inviteAnchor, labels: collectLabelsFromElement(inviteAnchor) };
  }

  let el: HTMLElement | null = target;

  while (el && el !== document.body) {
    const labels = collectLabelsFromElement(el);
    const componentKey = el.getAttribute("componentkey") ?? "";

    if (componentKey.includes("ConnectButton")) {
      return { element: el, labels };
    }

    if (
      componentKey.includes("SendButton") ||
      componentKey.includes("send_invitation") ||
      componentKey.includes("custom_invite")
    ) {
      return { element: el, labels };
    }

    if (el instanceof HTMLAnchorElement && el.href.includes("custom-invite")) {
      return { element: el, labels };
    }

    if (el.getAttribute("role") === "menuitem") {
      const labelsMatch = labels.some((l) => isSendInviteLabel(l) || isConnectLabel(l));
      if (labelsMatch || el.querySelector("[componentkey*='ConnectButton']")) {
        return { element: el, labels };
      }
    }

    if (labels.some((l) => isSendInviteLabel(l))) {
      return { element: el, labels };
    }

    if (labels.some((l) => isConnectLabel(l) && l.length <= 80)) {
      return { element: el, labels };
    }

    el = el.parentElement;
  }

  return null;
}

export function isExactSendWithoutNoteText(text: string): boolean {
  const t = text.trim();
  return (
    t === "Envoyer sans note" ||
    t === "Send without a note" ||
    t === "Envoyer sans une note"
  );
}

/** Trouve les éléments dont le texte visible est « Envoyer sans note » */
export function findSendWithoutNoteElements(): HTMLElement[] {
  const results: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(
      "span, button, a, div[role='button'], [componentkey], .artdeco-button--primary"
    )
  )) {
    const text = el.textContent?.trim() ?? "";
    const label = normalizeLabel(getElementLabel(el));

    const isSend =
      isExactSendWithoutNoteText(text) ||
      (isSendInviteLabel(label) && label.length <= 100);

    if (!isSend) continue;

    const clickable = (el.closest(
      "button, a, [role='button'], [componentkey], .artdeco-button--primary"
    ) ?? el) as HTMLElement;

    if (!seen.has(clickable)) {
      seen.add(clickable);
      results.push(clickable);
    }
  }

  return results;
}

export function isInviteModalVisible(): boolean {
  if (isCustomInvitePage()) return true;
  return findSendWithoutNoteElements().length > 0;
}

export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ");
}

export function isConnectLabel(label: string): boolean {
  const n = normalizeLabel(label);
  if (!n || n.length > 120) return false;
  if (
    n.includes("pending") ||
    n.includes("en attente") ||
    n.includes("message") ||
    n.includes("suivre") ||
    n.includes("follow") ||
    n.includes("retirer") ||
    n.includes("withdraw") ||
    n.includes("sans note")
  ) {
    return false;
  }
  return (
    n.includes("se connecter") ||
    n.includes("rejoindre votre réseau") ||
    n.includes("join your network") ||
    (n.includes("inviter") && n.includes("réseau")) ||
    (n.includes("invite") && n.includes("network"))
  );
}

export function isSendInviteLabel(label: string): boolean {
  const n = normalizeLabel(label);
  if (!n || n.length > 200) return false;
  return (
    n.includes("envoyer sans") ||
    n.includes("sans note") ||
    n.includes("sans notes") ||
    (n.includes("envoyer") && n.includes("sans")) ||
    n.includes("send without") ||
    (n.includes("send") && n.includes("without")) ||
    n.includes("send invitation") ||
    n.includes("envoyer l'invitation") ||
    n.includes("envoyer l’invitation") ||
    n.includes("envoyer une invitation")
  );
}

function isDismissInviteLabel(label: string): boolean {
  const n = normalizeLabel(label);
  return (
    n.includes("annuler") ||
    n.includes("cancel") ||
    n.includes("fermer") ||
    n.includes("close") ||
    n === "×"
  );
}

function isAddNoteOnlyLabel(label: string): boolean {
  const n = normalizeLabel(label);
  return (
    (n.includes("ajouter une note") || n.includes("add a note")) &&
    !n.includes("sans")
  );
}

function elementLooksLikeInviteOverlay(el: HTMLElement): boolean {
  const text = (el.textContent ?? "").toLowerCase();
  if (text.length > 800) return false;
  return (
    text.includes("envoyer sans") ||
    text.includes("sans note") ||
    text.includes("send without") ||
    text.includes("ajouter une note") ||
    text.includes("add a note")
  );
}

export function findInviteDialogRoot(target: HTMLElement): HTMLElement | null {
  const standard = target.closest(
    '[role="dialog"], .artdeco-modal, [data-test-modal], aside[aria-label*="invitation"]'
  );
  if (standard) return standard as HTMLElement;

  let el: HTMLElement | null = target;
  for (let depth = 0; depth < 20 && el; depth++) {
    if (elementLooksLikeInviteOverlay(el)) return el;
    el = el.parentElement;
  }

  return null;
}

export function isPrimaryActionElement(el: HTMLElement): boolean {
  const primary = el.closest(
    "button.artdeco-button--primary, .artdeco-button--primary, a.artdeco-button--primary"
  );
  if (primary) return true;
  if (el.classList.contains("artdeco-button--primary")) return true;
  return false;
}

/** Clic sur « Envoyer sans note » quand on attend déjà l’envoi (après Se connecter) */
export function isAwaitingSendClickTarget(target: HTMLElement): boolean {
  if (target.closest("textarea, [contenteditable='true']")) return false;

  let el: HTMLElement | null = target;
  for (let depth = 0; depth < 14 && el; depth++) {
    for (const label of collectLabelsFromElement(el)) {
      if (isDismissInviteLabel(label)) return false;
      if (isConnectLabel(label) && label.length <= 80) return false;
      if (isSendInviteLabel(label)) return true;
      if (isExactSendWithoutNoteText(label)) return true;
    }

    const raw = (el.textContent ?? "").trim();
    if (raw.length <= 50 && isExactSendWithoutNoteText(raw)) return true;

    const n = normalizeLabel(raw);
    if (raw.length <= 24 && (n === "envoyer" || n === "send")) return true;

    el = el.parentElement;
  }

  return false;
}

/** Détecte le clic « Envoyer sans note » dans modale ou page custom-invite */
export function isLikelySendInviteClick(target: HTMLElement, awaitingSend = false): boolean {
  if (awaitingSend && isAwaitingSendClickTarget(target)) return true;

  const onInvitePage = isCustomInvitePage();
  const dialog = findInviteDialogRoot(target);

  if (!onInvitePage && !dialog && !awaitingSend) return false;

  if (target.closest("textarea, [contenteditable='true']")) return false;

  const clickRoot = (target.closest(
    "button, [role='button'], a, [componentkey], .artdeco-button"
  ) ?? target) as HTMLElement;

  const labels = new Set<string>();
  let el: HTMLElement | null = clickRoot;
  for (let depth = 0; depth < 8 && el; depth++) {
    for (const label of collectLabelsFromElement(el)) labels.add(label);
    if (dialog && !dialog.contains(el)) break;
    el = el.parentElement;
  }

  const combined = normalizeLabel(Array.from(labels).join(" | "));

  if (isDismissInviteLabel(combined)) return false;
  if (isAddNoteOnlyLabel(combined)) return false;

  if (Array.from(labels).some((l) => isSendInviteLabel(l))) return true;

  if (
    (combined.includes("envoyer") || combined.includes("send")) &&
    !combined.includes("connecter") &&
    !combined.includes("inviter")
  ) {
    return true;
  }

  if ((onInvitePage || dialog || awaitingSend) && isPrimaryActionElement(clickRoot)) {
    if (!combined.includes("connecter") && !combined.includes("inviter")) return true;
  }

  return false;
}

export function isPendingLabel(label: string): boolean {
  const n = normalizeLabel(label);
  return (
    n.includes("pending") ||
    n.includes("en attente") ||
    n.includes("invitation envoyée") ||
    n.includes("invitation sent")
  );
}

function cleanJobTitle(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";

  t = t.split(/\s*[·•]\s*/)[0]?.trim() ?? t;
  t = t.replace(/\s+\d+\+?\s*(relations|connections).*$/i, "").trim();

  if (t.length > 180) t = t.slice(0, 180).trim();
  return t;
}

function isBadJobTitleCandidate(text: string): boolean {
  const t = text.toLowerCase();
  if (text.length < 3 || text.length > 200) return true;
  return (
    /^(se connecter|message|suivre|plus|en attente|connecter|inviter|voir|voir le profil)$/i.test(
      text
    ) ||
    t.includes("profil linkedin") ||
    t.includes("profile on linkedin") ||
    t.includes("sign up") ||
    t.includes("linkedin login")
  );
}

function decodeJsonString(s: string): string {
  return s
    .replace(/\\u([0-9a-f]{4})/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function findProfileNameElement(root: ParentNode = document): HTMLElement | null {
  return (
    root.querySelector("main h2") ??
    root.querySelector("main h1.text-heading-xlarge") ??
    root.querySelector("main h1") ??
    root.querySelector("h2") ??
    root.querySelector("h1.text-heading-xlarge") ??
    root.querySelector("[data-anonymize='person-name']") ??
    root.querySelector("h1")
  );
}

function normalizeNameCompare(text: string): string {
  return text
    .replace(/[^\w\sÀ-ÿ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isConnectionBadgeText(text: string): boolean {
  const t = text.trim();
  return /^·\s*\d/i.test(t) || t === "·";
}

function isLikelyLocationText(text: string): boolean {
  const t = text.trim();
  if (!t.includes(",")) return false;
  if (/\b(France|Belgique|Belgium|United States|UK|Royaume-Uni|Suisse|Switzerland)\b/i.test(t)) {
    return true;
  }
  // Paris, Île-de-France, France
  return (t.match(/,/g) ?? []).length >= 1 && t.length < 120;
}

function isLikelyEducationText(text: string): boolean {
  const t = text.trim();
  if (!t.includes("·") || t.startsWith("·")) return false;
  if (
    /\b(school|university|université|institut|academy|école|college|lycée|business school)\b/i.test(
      t
    )
  ) {
    return true;
  }
  const parts = t.split("·").map((s) => s.trim());
  return parts.length === 2 && parts.every((p) => p.length >= 3 && p.length <= 90);
}

/** Nouvelle UI LinkedIn : h2 + paragraphes (headline, école, ville) */
function extractJobTitleFromProfileCard(root: ParentNode, profileName: string): string {
  const nameEl = findProfileNameElement(root);
  if (!nameEl) return "";

  const nameNorm = normalizeNameCompare(profileName);
  const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>("main p"));

  for (const p of paragraphs) {
    if (nameEl.contains(p)) continue;
    if (
      nameEl.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_PRECEDING
    ) {
      continue;
    }

    const raw = (p.textContent ?? "").trim().replace(/\s+/g, " ");
    if (!raw || raw.length < 3) continue;
    if (isConnectionBadgeText(raw)) continue;
    if (normalizeNameCompare(raw) === nameNorm) continue;
    if (isLikelyLocationText(raw)) continue;
    if (isLikelyEducationText(raw)) continue;
    if (p.querySelector("a") && raw.length < 40) continue;

    const cleaned = cleanJobTitle(raw);
    if (cleaned.length >= 3 && !isBadJobTitleCandidate(cleaned)) {
      return cleaned;
    }
  }

  return "";
}

function extractLocationFromProfileCard(root: ParentNode): string {
  for (const p of Array.from(root.querySelectorAll<HTMLParagraphElement>("main p"))) {
    const raw = (p.textContent ?? "").trim().replace(/\s+/g, " ");
    if (isLikelyLocationText(raw)) return raw;
  }
  return "";
}

/** Extrait le poste sans dépendre des classes CSS LinkedIn */
export function extractJobTitle(root: ParentNode = document): string {
  const nameEl = findProfileNameElement(root);
  const profileName = nameEl?.textContent?.trim() ?? "";

  // 1. Carte profil (nouvelle UI : h2 + <p> headline)
  if (location.pathname.includes("/in/") && profileName) {
    const fromCard = extractJobTitleFromProfileCard(root, profileName);
    if (fromCard) return fromCard;
  }

  // 2. Meta
  for (const sel of [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[property="twitter:description"]',
  ]) {
    const content = root.querySelector(sel)?.getAttribute("content");
    if (!content || isBadJobTitleCandidate(content)) continue;
    const cleaned = cleanJobTitle(content);
    if (cleaned.length >= 3 && !isBadJobTitleCandidate(cleaned)) return cleaned;
  }

  // 3. JSON-LD
  for (const script of Array.from(root.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.jobTitle) {
          const cleaned = cleanJobTitle(String(item.jobTitle));
          if (cleaned.length >= 3) return cleaned;
        }
        if (item?.worksFor?.name) {
          const cleaned = cleanJobTitle(String(item.worksFor.name));
          if (cleaned.length >= 3) return cleaned;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 4. Données embarquées Voyager (headline / subtitle)
  const scriptPatterns = [
    /"headline"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"occupation"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"subtitle"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"multiLocaleHeadline"\s*:\s*\{[^}]*"fr_FR"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"multiLocaleHeadline"\s*:\s*\{[^}]*"en_US"\s*:\s*"((?:\\.|[^"\\])*)"/,
  ];
  for (const script of Array.from(root.querySelectorAll("script:not([src])"))) {
    const content = script.textContent ?? "";
    if (content.length < 100) continue;
    for (const pattern of scriptPatterns) {
      const match = content.match(pattern);
      if (!match?.[1]) continue;
      const decoded = decodeJsonString(match[1]);
      const cleaned = cleanJobTitle(decoded);
      if (cleaned.length >= 3 && !isBadJobTitleCandidate(cleaned)) return cleaned;
    }
  }

  // 5. DOM : texte juste sous le titre du profil (h1 ou h2)
  const heading = findProfileNameElement(root);
  const profileNameLegacy = heading?.textContent?.trim() ?? "";

  if (heading?.parentElement) {
    const parent = heading.parentElement;
    for (const child of Array.from(parent.children)) {
      if (child.contains(heading)) continue;
      const text = cleanJobTitle(child.textContent ?? "");
      if (text.length >= 3 && text !== profileNameLegacy && !isBadJobTitleCandidate(text)) {
        return text;
      }
    }
  }

  // 6. Sélecteurs classiques LinkedIn
  const selectors = [
    "[data-anonymize='headline']",
    ".pv-text-details__left-panel .text-body-medium",
    ".pv-top-card--list .text-body-medium",
    ".pv-top-card .text-body-medium",
    "main .text-body-medium.break-words",
    ".ph5 .text-body-medium",
    "main .text-body-medium",
  ];
  for (const sel of selectors) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
      const text = cleanJobTitle(el.textContent ?? "");
      if (text.length >= 3 && text !== profileNameLegacy && !isBadJobTitleCandidate(text)) {
        return text;
      }
    }
  }

  // 7. Parcours DOM générique
  if (heading) {
    let container: HTMLElement | null = heading.parentElement;
    for (let depth = 0; depth < 8 && container; depth++) {
      for (const el of Array.from(container.querySelectorAll<HTMLElement>("div, p, span"))) {
        if (el.querySelector("h1") || el.querySelector("h2")) continue;
        const own = Array.from(el.childNodes)
          .map((n) => n.textContent?.trim())
          .filter(Boolean)
          .join(" ");
        const text = cleanJobTitle(own || (el.textContent ?? ""));
        if (
          text.length >= 3 &&
          text.length <= 120 &&
          text !== profileNameLegacy &&
          !isBadJobTitleCandidate(text)
        ) {
          return text;
        }
      }
      container = container.parentElement;
    }
  }

  return "";
}

export function extractProfileData(): {
  name: string;
  profileUrl: string;
  profilePicture?: string;
  jobTitle?: string;
  location?: string;
} | null {
  const profileUrl = findActiveProfileUrl();
  if (!profileUrl) return null;

  const nameEl = findProfileNameElement(document);

  let name = nameEl?.textContent?.trim() ?? "";

  if (!name) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    if (ogTitle) {
      name = ogTitle.split("|")[0].split("–")[0].split("-")[0].trim();
    }
  }

  if (!name && document.title) {
    name = document.title.split("|")[0].split("–")[0].split("-")[0].trim();
  }

  if (!name) {
    const inviteAria = document.querySelector<HTMLElement>(
      "[aria-label*='Inviter'][aria-label*='réseau']"
    );
    if (inviteAria) {
      const parsed = parseNameFromInviteLabel(inviteAria.getAttribute("aria-label") ?? "");
      if (parsed) name = parsed;
    }
  }

  if (!name) return null;

  const jobTitle = extractJobTitle(document) || extractJobTitleFromProfileCard(document, name);
  const location = extractLocationFromProfileCard(document);

  const imgEl =
    document.querySelector("main img.pv-top-card-profile-picture__image") ??
    document.querySelector("main button.pv-top-card-profile-picture img") ??
    document.querySelector("img[src*='profile-displayphoto']") ??
    document.querySelector('meta[property="og:image"]');

  const profilePicture =
    imgEl instanceof HTMLMetaElement
      ? imgEl.getAttribute("content")
      : (imgEl?.getAttribute("src") ?? undefined);

  return {
    name,
    profileUrl,
    profilePicture: profilePicture ?? undefined,
    jobTitle: jobTitle || undefined,
    location: location || undefined,
  };
}

export function hasPendingInvitationButton(): boolean {
  const selectors = [
    "button",
    "a[role='button']",
    "div[role='button']",
    "[role='menuitem']",
    "div[aria-label]",
    "[componentkey*='ConnectButton']",
  ];

  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const labels = collectLabelsFromElement(el);
      if (labels.some((l) => isPendingLabel(l))) return true;
    }
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrollToBottom(intervalMs = 800, maxScrolls = 50): Promise<void> {
  let scrollCount = 0;
  let lastHeight = 0;

  while (scrollCount < maxScrolls) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(intervalMs);
    const currentHeight = document.body.scrollHeight;
    if (currentHeight === lastHeight) break;
    lastHeight = currentHeight;
    scrollCount++;
  }
}

function profileUrlFromHref(href: string): string | null {
  try {
    const match = new URL(href).pathname.match(/\/in\/([^/?#]+)/);
    if (!match) return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
}

function nameFromConnectionAnchor(anchor: HTMLAnchorElement): string {
  const direct = anchor.textContent?.trim() ?? "";
  if (direct && direct.length >= 2 && direct.length <= 80) return direct;

  const aria = anchor.getAttribute("aria-label")?.trim() ?? "";
  if (aria && aria.length >= 2 && aria.length <= 80) return aria;

  const card =
    anchor.closest(
      "[class*='connection-card'], [class*='mn-connection'], li.artdeco-list__item, [data-view-name*='connection']"
    ) ?? anchor.parentElement;

  if (card) {
    for (const sel of [
      "[class*='name']",
      "span[dir='auto']",
      "span[aria-hidden='true']",
      ".mn-connection-card__name",
      "p",
      "span",
    ]) {
      for (const el of Array.from(card.querySelectorAll<HTMLElement>(sel))) {
        const t = el.textContent?.trim() ?? "";
        if (t.length >= 2 && t.length <= 80 && !t.includes("http")) return t;
      }
    }
  }

  return direct;
}

/** Scroll la liste de connexions (conteneur scrollable LinkedIn) */
export async function scrollConnectionsList(maxScrolls = 35): Promise<void> {
  const scrollRoot =
    document.querySelector<HTMLElement>(".scaffold-finite-scroll__content") ??
    document.querySelector<HTMLElement>("[class*='scaffold-finite-scroll']") ??
    document.querySelector<HTMLElement>("main .scaffold-layout__main") ??
    document.querySelector<HTMLElement>("main") ??
    document.documentElement;

  let lastCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    if (scrollRoot === document.documentElement || scrollRoot === document.body) {
      window.scrollTo(0, document.body.scrollHeight);
    } else {
      scrollRoot.scrollTop = scrollRoot.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    }

    await sleep(900);

    const currentCount = document.querySelectorAll(
      "a[data-control-name='connection_profile'], a[href*='/in/'][data-control-name*='connection']"
    ).length;

    if (currentCount <= lastCount) {
      stableRounds++;
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
      lastCount = currentCount;
    }
  }
}

export function parseConnectionsFromPage(): Array<{ name: string; profileUrl: string }> {
  const results: Array<{ name: string; profileUrl: string }> = [];
  const seen = new Set<string>();

  const add = (href: string, name: string): void => {
    const profileUrl = profileUrlFromHref(href);
    if (!profileUrl || seen.has(profileUrl)) return;

    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!cleanName || cleanName.length < 2 || cleanName.length > 80) return;
    if (/^(voir|view|message|plus|more)$/i.test(cleanName)) return;

    seen.add(profileUrl);
    results.push({ name: cleanName, profileUrl });
  };

  for (const anchor of Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      "a[data-control-name='connection_profile'], a[href*='/in/'][data-control-name*='connection']"
    )
  )) {
    if (!anchor.href) continue;
    add(anchor.href, nameFromConnectionAnchor(anchor));
  }

  const searchRoot = document.querySelector("main") ?? document.body;
  for (const anchor of Array.from(searchRoot.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']"))) {
    if (!anchor.href || anchor.href.includes("/company/")) continue;
    const path = anchor.pathname;
    if (!/^\/in\/[^/]+\/?$/.test(path)) continue;
    add(anchor.href, nameFromConnectionAnchor(anchor));
  }

  return results;
}
