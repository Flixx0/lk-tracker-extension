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
  const t = text.trim();
  const lower = t.toLowerCase();
  if (text.length < 3 || text.length > 200) return true;
  if (isLikelyPronounsText(text)) return true;
  if (/^\d+\+?\s*(relations|connections|abonnés|followers)/i.test(t)) return true;
  if (/^[·•]\s*\d/.test(t)) return true;
  if (/^(1er|2e|3e|1st|2nd|3rd|2nd degree|3rd degree)$/i.test(t)) return true;
  if (/contact info|coordonnées|informations de contact/i.test(lower)) return true;
  if (/^(open to work|disponible|hiring|recrute)$/i.test(lower)) return true;
  return (
    /^(se connecter|message|suivre|plus|en attente|connecter|inviter|voir|voir le profil)$/i.test(
      text
    ) ||
    lower.includes("profil linkedin") ||
    lower.includes("profile on linkedin") ||
    lower.includes("sign up") ||
    lower.includes("linkedin login")
  );
}

function isLikelyPronounsText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;

  const withoutBadge = t.replace(/\s*·.*$/, "").trim();
  const pronounPatterns = [
    /^he\/him$/i,
    /^she\/her$/i,
    /^they\/them$/i,
    /^he\/they$/i,
    /^she\/they$/i,
    /^any\/any$/i,
    /^il\/lui$/i,
    /^iel$/i,
    /^iel\/iel$/i,
    /^elle$/i,
    /^xe\/xem$/i,
    /^ze\/hir$/i,
  ];
  if (pronounPatterns.some((p) => p.test(withoutBadge))) return true;

  // Format court type "Il/Lui" ou "He/Him"
  if (
    withoutBadge.length <= 15 &&
    /^[\p{L}]+\/[\p{L}]+$/u.test(withoutBadge)
  ) {
    return true;
  }

  return false;
}

function scoreHeadlineCandidate(text: string, profileName: string): number {
  if (isBadJobTitleCandidate(text)) return -1;
  if (normalizeNameCompare(text) === normalizeNameCompare(profileName)) return -1;
  if (isLikelyLocationText(text)) return -1;
  if (isLikelyEducationText(text)) return -1;

  let score = 0;
  if (text.length >= 12) score += 2;
  if (text.length >= 25) score += 2;
  if (
    /\b(at|chez|@|ceo|cto|cfo|founder|fondateur|directeur|directrice|manager|engineer|developer|consultant|lead|head of|responsable|freelance|consultante|consultant)\b/i.test(
      text
    )
  ) {
    score += 4;
  }
  if (/\||–|-/.test(text)) score += 1;
  return score;
}

function extractHeadlineFromVoyagerScripts(root: ParentNode = document): string {
  const scriptPatterns = [
    /"headline"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"occupation"\s*:\s*"((?:\\.|[^"\\])*)"/,
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
  return "";
}

function findSectionByHeading(
  root: ParentNode,
  headings: string[]
): HTMLElement | null {
  const normalized = new Set(headings.map((h) => h.toLowerCase()));
  for (const h2 of Array.from(root.querySelectorAll<HTMLElement>("h2, h3"))) {
    const text = h2.textContent?.trim().toLowerCase() ?? "";
    if (!normalized.has(text)) continue;
    return h2.closest("section") ?? h2.parentElement;
  }
  return null;
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

function visibleTextBlocks(container: HTMLElement): string[] {
  const blocks: string[] = [];
  for (const el of Array.from(
    container.querySelectorAll<HTMLElement>("span[aria-hidden='true'], p, div")
  )) {
    if (el.closest(".visually-hidden")) continue;
    if (el.querySelector("span[aria-hidden='true'], p, div")) continue;
    const t = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (t.length >= 2 && t.length <= 300) blocks.push(t);
  }
  return dedupeStrings(blocks);
}

function extractAboutSection(root: ParentNode = document): string {
  const aboutAnchor = root.querySelector("#about");
  const section =
    aboutAnchor?.closest("section") ??
    findSectionByHeading(root, ["About", "À propos", "Infos", "Info"]);

  if (!section) return "";

  const expandText =
    section.querySelector<HTMLElement>(".inline-show-more-text, [class*='inline-show-more']")
      ?.textContent ??
    section.querySelector<HTMLElement>("[class*='display-flex'][class*='full-width']")
      ?.textContent;

  let text = (expandText ?? "").trim().replace(/\s+/g, " ");
  if (text.length < 30) {
    const blocks = visibleTextBlocks(section as HTMLElement).filter(
      (b) => !/^(about|à propos|infos)$/i.test(b)
    );
    text = blocks.join(" ").trim();
  }

  if (text.length < 30) return "";
  return text.slice(0, 2500);
}

function extractExperiencesFromPage(
  root: ParentNode = document,
  limit = 5
): Array<{
  title: string;
  company?: string;
  period?: string;
  location?: string;
  description?: string;
}> {
  const section =
    root.querySelector<HTMLElement>('section[id*="experience"]') ??
    findSectionByHeading(root, ["Experience", "Expérience"]);

  if (!section) return [];

  const results: Array<{
    title: string;
    company?: string;
    period?: string;
    location?: string;
    description?: string;
  }> = [];

  const items = section.querySelectorAll<HTMLElement>(
    "li.artdeco-list__item, li.pvs-list__paged-list-item, ul.pvs-list > li"
  );

  for (const item of Array.from(items).slice(0, limit)) {
    const blocks = visibleTextBlocks(item).filter(
      (b) => !/^(experience|expérience)$/i.test(b)
    );
    if (blocks.length === 0) continue;

    const exp: {
      title: string;
      company?: string;
      period?: string;
      location?: string;
      description?: string;
    } = { title: blocks[0] };

    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      if (!exp.company && b.length <= 120 && !/\d{4}/.test(b)) {
        exp.company = b;
        continue;
      }
      if (
        !exp.period &&
        (/\d{4}/.test(b) || /present|aujourd|actuel|current|–|-/i.test(b))
      ) {
        exp.period = b;
        continue;
      }
      if (!exp.location && isLikelyLocationText(b)) {
        exp.location = b;
        continue;
      }
      if (!exp.description && b.length > 40) {
        exp.description = b.slice(0, 500);
      }
    }

    if (exp.title && !isBadJobTitleCandidate(exp.title)) {
      results.push(exp);
    }
  }

  return results;
}

function extractEducationFromPage(
  root: ParentNode = document,
  limit = 3
): Array<{ school: string; degree?: string; period?: string }> {
  const section =
    root.querySelector<HTMLElement>('section[id*="education"]') ??
    findSectionByHeading(root, ["Education", "Formation"]);

  if (!section) return [];

  const results: Array<{ school: string; degree?: string; period?: string }> = [];
  const items = section.querySelectorAll<HTMLElement>(
    "li.artdeco-list__item, li.pvs-list__paged-list-item, ul.pvs-list > li"
  );

  for (const item of Array.from(items).slice(0, limit)) {
    const blocks = visibleTextBlocks(item).filter(
      (b) => !/^(education|formation)$/i.test(b)
    );
    if (blocks.length === 0) continue;

    const edu: { school: string; degree?: string; period?: string } = {
      school: blocks[0],
    };
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      if (!edu.degree && !/\d{4}/.test(b)) edu.degree = b;
      else if (!edu.period && /\d{4}/.test(b)) edu.period = b;
    }
    results.push(edu);
  }

  return results;
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
  let best = "";
  let bestScore = -1;

  const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>("main p"));

  for (const p of paragraphs) {
    if (nameEl.contains(p)) continue;
    if (nameEl.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_PRECEDING) {
      continue;
    }

    const raw = (p.textContent ?? "").trim().replace(/\s+/g, " ");
    if (!raw || raw.length < 3) continue;
    if (isConnectionBadgeText(raw)) continue;
    if (normalizeNameCompare(raw) === nameNorm) continue;
    if (isLikelyPronounsText(raw)) continue;
    if (isLikelyLocationText(raw)) continue;
    if (isLikelyEducationText(raw)) continue;
    if (p.querySelector("a") && raw.length < 40) continue;

    const cleaned = cleanJobTitle(raw);
    const score = scoreHeadlineCandidate(cleaned, profileName);
    if (score > bestScore) {
      bestScore = score;
      best = cleaned;
    }
  }

  return best;
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

  // 1. Attribut dédié LinkedIn
  const anonymized = root.querySelector("[data-anonymize='headline']");
  if (anonymized) {
    const cleaned = cleanJobTitle(anonymized.textContent ?? "");
    if (cleaned.length >= 3 && !isBadJobTitleCandidate(cleaned)) return cleaned;
  }

  // 2. Données embarquées Voyager (fiable, avant le scan des <p>)
  const fromVoyager = extractHeadlineFromVoyagerScripts(root);
  if (fromVoyager) return fromVoyager;

  // 3. JSON-LD
  for (const script of Array.from(root.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.jobTitle) {
          const cleaned = cleanJobTitle(String(item.jobTitle));
          if (cleaned.length >= 3 && !isBadJobTitleCandidate(cleaned)) return cleaned;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 4. Carte profil (nouvelle UI : h2 + <p> headline, pronoms filtrés)
  if (location.pathname.includes("/in/") && profileName) {
    const fromCard = extractJobTitleFromProfileCard(root, profileName);
    if (fromCard) return fromCard;
  }

  // 5. Poste actuel depuis la section expérience
  const currentExp = extractExperiencesFromPage(root, 1)[0];
  if (currentExp?.title && !isBadJobTitleCandidate(currentExp.title)) {
    return currentExp.title;
  }

  // 6. Meta
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

  // 7. DOM : texte juste sous le titre du profil (h1 ou h2)
  const heading = findProfileNameElement(root);
  const profileNameLegacy = heading?.textContent?.trim() ?? "";

  if (heading?.parentElement) {
    const parent = heading.parentElement;
    for (const child of Array.from(parent.children)) {
      if (child.contains(heading)) continue;
      const text = cleanJobTitle(child.textContent ?? "");
      if (
        text.length >= 3 &&
        text !== profileNameLegacy &&
        !isBadJobTitleCandidate(text) &&
        !isLikelyPronounsText(text)
      ) {
        return text;
      }
    }
  }

  // 8. Sélecteurs classiques LinkedIn
  const selectors = [
    "[data-anonymize='headline']",
    ".pv-text-details__left-panel .text-body-medium",
    ".pv-top-card--list .text-body-medium",
    ".pv-top-card .text-body-medium",
    "main .text-body-medium.break-words",
    ".ph5 .text-body-medium",
  ];
  for (const sel of selectors) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest("header, nav, [role='navigation']")) continue;
      const text = cleanJobTitle(el.textContent ?? "");
      if (
        text.length >= 3 &&
        text !== profileNameLegacy &&
        !isBadJobTitleCandidate(text) &&
        !isLikelyPronounsText(text)
      ) {
        return text;
      }
    }
  }

  // 9. Parcours DOM générique (dernier recours)
  if (heading) {
    let container: HTMLElement | null = heading.parentElement;
    for (let depth = 0; depth < 6 && container; depth++) {
      let best = "";
      let bestScore = -1;
      for (const el of Array.from(container.querySelectorAll<HTMLElement>("div, p, span"))) {
        if (el.querySelector("h1") || el.querySelector("h2")) continue;
        const own = Array.from(el.childNodes)
          .map((n) => n.textContent?.trim())
          .filter(Boolean)
          .join(" ");
        const text = cleanJobTitle(own || (el.textContent ?? ""));
        const score = scoreHeadlineCandidate(text, profileNameLegacy);
        if (score > bestScore) {
          bestScore = score;
          best = text;
        }
      }
      if (best) return best;
      container = container.parentElement;
    }
  }

  return "";
}

function isValidProfilePhotoUrl(url: string): boolean {
  if (!url || url.startsWith("data:")) return false;
  if (url.includes("ghost")) return false;
  return url.includes("profile-displayphoto") || url.includes("licdn.com/dms/image");
}

function resolveBestImageUrl(img: HTMLImageElement): string | undefined {
  const srcset = img.getAttribute("srcset");
  if (srcset) {
    let bestUrl = "";
    let bestW = 0;
    for (const entry of srcset.split(",")) {
      const parts = entry.trim().split(/\s+/);
      const url = parts[0];
      const w = parts[1]?.endsWith("w") ? parseInt(parts[1], 10) : 0;
      if (url && w >= bestW) {
        bestW = w;
        bestUrl = url;
      }
    }
    if (bestUrl) return bestUrl;
  }
  return img.currentSrc || img.src || img.getAttribute("src") || undefined;
}

function queryProfilePhotoImg(root: ParentNode = document): HTMLImageElement | null {
  const selectors = [
    '[componentkey="topcard-logo-image-referencekey"] img',
    '[componentkey*="topcard-logo-image"] img',
    '[aria-label="Photo de profil"] img',
    '[aria-label*="Photo de profil"] img',
    '[aria-label="Profile photo"] img',
    '[aria-label*="Profile photo"] img',
  ];

  for (const sel of selectors) {
    const img = root.querySelector<HTMLImageElement>(sel);
    if (img) return img;
  }

  const photoContainer = root.querySelector<HTMLElement>(
    '[aria-label="Photo de profil"], [aria-label*="Photo de profil"], [aria-label="Profile photo"], [aria-label*="Profile photo"]'
  );
  return photoContainer?.querySelector<HTMLImageElement>("img") ?? null;
}

/** Photo du profil visité — pas l'avatar du header / nav */
function extractProfilePicture(nameEl: HTMLElement | null): string | undefined {
  const topCardImg = queryProfilePhotoImg();
  if (topCardImg) {
    const url = resolveBestImageUrl(topCardImg);
    if (url && isValidProfilePhotoUrl(url)) return url;
  }

  const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (og?.trim() && isValidProfilePhotoUrl(og)) return og.trim();

  if (nameEl) {
    let container: HTMLElement | null = nameEl;
    for (let depth = 0; depth < 14 && container; depth++) {
      const scopedImg = queryProfilePhotoImg(container);
      if (scopedImg) {
        const url = resolveBestImageUrl(scopedImg);
        if (url && isValidProfilePhotoUrl(url)) return url;
      }

      const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
      const candidates = imgs.filter((img) => {
        const src = img.currentSrc || img.src || img.getAttribute("src") || "";
        if (!isValidProfilePhotoUrl(src)) return false;
        if (img.closest("header, nav, [role='navigation'], [data-test-global-nav]")) return false;
        return src.includes("profile-displayphoto");
      });

      if (candidates.length > 0) {
        const best = candidates.sort(
          (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
        )[0];
        const url = resolveBestImageUrl(best);
        if (url) return url;
      }

      if (container.parentElement?.tagName === "MAIN" && depth > 2) break;
      container = container.parentElement;
    }
  }

  const legacy =
    document.querySelector<HTMLImageElement>("main img.pv-top-card-profile-picture__image") ??
    document.querySelector<HTMLImageElement>("main button.pv-top-card-profile-picture img");
  const legacyUrl = legacy ? resolveBestImageUrl(legacy) : undefined;
  return legacyUrl && isValidProfilePhotoUrl(legacyUrl) ? legacyUrl : undefined;
}

export function extractProfileData(): {
  name: string;
  profileUrl: string;
  profilePicture?: string;
  jobTitle?: string;
  location?: string;
  about?: string;
  experiences?: Array<{
    title: string;
    company?: string;
    period?: string;
    location?: string;
    description?: string;
  }>;
  education?: Array<{ school: string; degree?: string; period?: string }>;
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
  const profilePicture = extractProfilePicture(nameEl);
  const about = extractAboutSection(document);
  const experiences = extractExperiencesFromPage(document, 5);
  const education = extractEducationFromPage(document, 3);

  return {
    name,
    profileUrl,
    profilePicture: profilePicture ?? undefined,
    jobTitle: jobTitle || undefined,
    location: location || undefined,
    about: about || undefined,
    experiences: experiences.length > 0 ? experiences : undefined,
    education: education.length > 0 ? education : undefined,
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

export interface MessagingConversationEntry {
  name: string;
  profileUrl?: string;
  threadHref?: string;
  element?: HTMLElement;
}

/** Conteneur scrollable de la liste de conversations LinkedIn */
function findMessagingListScrollRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>(".msg-conversations-container__conversations-list") ??
    document.querySelector<HTMLElement>(".msg-conversations-container") ??
    document.querySelector<HTMLElement>(".scaffold-finite-scroll__content") ??
    document.querySelector<HTMLElement>("[class*='msg-conversations']") ??
    document.querySelector<HTMLElement>("[class*='conversations-list']") ??
    document.querySelector<HTMLElement>("aside .scaffold-finite-scroll") ??
    document.querySelector<HTMLElement>("aside") ??
    document.querySelector<HTMLElement>("main") ??
    document.documentElement
  );
}

function findMessagingListRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>(".msg-conversations-container") ??
    document.querySelector<HTMLElement>("[class*='msg-conversations']") ??
    document.querySelector<HTMLElement>("[class*='conversations-list']") ??
    document.querySelector<HTMLElement>("aside") ??
    document.querySelector<HTMLElement>("main") ??
    document.body
  );
}

function countMessagingConversationItems(): number {
  return getMessagingConversationElements().length;
}

function getMessagingConversationElements(): HTMLElement[] {
  const root = findMessagingListRoot();
  const seen = new Set<HTMLElement>();
  const items: HTMLElement[] = [];

  const push = (card: HTMLElement | null): void => {
    if (!card || seen.has(card)) return;
    seen.add(card);
    items.push(card);
  };

  // Sélecteurs LinkedIn (DOM réel : li.msg-conversation-listitem.msg-conversations-container__convo-item)
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "li.msg-conversation-listitem",
        "li.msg-conversations-container__convo-item",
        ".msg-conversations-container__conversations-list > li",
        ".msg-conversation-listitem",
        "[class*='msg-conversation-listitem']",
      ].join(", ")
    )
  )) {
    // Ignorer les li vides / occlus
    if (el.matches("li") && !el.textContent?.trim()) continue;
    if (el.classList.contains("msg-conversation-card--occluded")) continue;
    push(
      (el.closest(".msg-conversation-listitem") as HTMLElement | null) ??
        (el.closest("li") as HTMLElement | null) ??
        el
    );
  }

  // Filet : liens thread
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>("a[href*='/messaging/thread/']")
  )) {
    push(
      (el.closest(".msg-conversation-listitem") as HTMLElement | null) ??
        (el.closest("li") as HTMLElement | null) ??
        el
    );
  }

  // UI plus récente / data-view-name
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>(
      "[data-view-name*='message-list'], [data-view-name*='conversation-list'] li, [data-view-name*='inbox'] li"
    )
  )) {
    if (!el.textContent?.trim()) continue;
    push(el);
  }

  return items;
}

function cleanParticipantName(name: string): string {
  return name
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyGroupChatName(name: string): boolean {
  const cleaned = cleanParticipantName(name);
  if (cleaned.includes(",") || cleaned.includes("·")) return true;
  if (/\s+et\s+/i.test(cleaned) || /\s+and\s+/i.test(cleaned)) return true;
  if (cleaned.split(/\s+/).filter(Boolean).length > 5) return true;
  return false;
}

function participantNameFromConversationCard(card: HTMLElement): string | null {
  // Structure réelle LinkedIn 2025/2026 :
  // h3.msg-conversation-listitem__participant-names > span.truncate
  const title = card.querySelector<HTMLElement>(
    "h3.msg-conversation-listitem__participant-names, h3.msg-conversation-card__participant-names, .msg-conversation-listitem__participant-names"
  );
  if (title) {
    const span = title.querySelector<HTMLElement>("span.truncate, span");
    const raw = (span?.textContent ?? title.textContent)?.trim().replace(/\s+/g, " ") ?? "";
    const cleaned = cleanParticipantName(raw);
    if (cleaned.length >= 2 && cleaned.length <= 100) return cleaned;
  }

  const imgAlt = card
    .querySelector<HTMLImageElement>("img.presence-entity__image, img.EntityPhoto-circle-4, img[alt]")
    ?.alt?.trim();
  if (imgAlt) {
    const cleaned = cleanParticipantName(imgAlt);
    if (cleaned.length >= 2 && cleaned.length <= 100) return cleaned;
  }

  // aria-label="Sélectionner la conversation avec Melinda Online"
  for (const el of Array.from(card.querySelectorAll<HTMLElement>("[aria-label]"))) {
    const aria = el.getAttribute("aria-label")?.trim() ?? "";
    const m = aria.match(
      /(?:Sélectionner la conversation avec|Select conversation with|conversation avec|conversation with)\s+(.+)/i
    );
    if (m?.[1]) {
      const cleaned = cleanParticipantName(m[1]);
      if (cleaned.length >= 2 && !isLikelyGroupChatName(cleaned)) return cleaned;
    }
  }

  const selectors = [
    "[class*='participant-names']",
    "h3",
    "[class*='entity-lockup__title']",
  ];

  for (const sel of selectors) {
    for (const el of Array.from(card.querySelectorAll<HTMLElement>(sel))) {
      const t = cleanParticipantName(el.textContent?.trim().replace(/\s+/g, " ") ?? "");
      if (t.length >= 2 && t.length <= 100 && !t.includes("http") && !/^\d+$/.test(t)) {
        if (/^(voir|view|message|plus|more|nouveau|new|messaging)$/i.test(t)) continue;
        if (isLikelyGroupChatName(t)) continue;
        return t;
      }
    }
  }

  return null;
}

function threadHrefFromCard(card: HTMLElement): string | undefined {
  if (card instanceof HTMLAnchorElement && card.href.includes("/messaging/thread/")) {
    return card.href.split("?")[0];
  }
  const link = card.querySelector<HTMLAnchorElement>("a[href*='/messaging/thread/']");
  return link?.href?.split("?")[0];
}

/** Zone cliquable réelle : div.msg-conversation-listitem__link (pas un <a href>). */
function conversationClickTarget(card: HTMLElement): HTMLElement {
  return (
    card.querySelector<HTMLElement>(".msg-conversation-listitem__link") ??
    card.querySelector<HTMLElement>(".msg-conversations-container__convo-item-link") ??
    card.querySelector<HTMLElement>(".msg-conversation-card") ??
    card.querySelector<HTMLElement>("a[href*='/messaging/thread/']") ??
    card
  );
}

function clickConversationCard(card: HTMLElement): void {
  const target = conversationClickTarget(card);
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
  );
  // Certains handlers Ember écoutent aussi le click natif
  if (typeof target.click === "function") target.click();
}

function profileUrlFromCard(card: HTMLElement): string | undefined {
  for (const anchor of Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']"))) {
    const url = profileUrlFromHref(anchor.href);
    if (url) return url;
  }
  return undefined;
}

/** Attend que la liste de messages soit présente dans le DOM */
export async function waitForMessagingList(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (countMessagingConversationItems() > 0) return true;
    if (
      document.querySelector(".msg-conversation-listitem__participant-names") ||
      document.querySelector(".msg-conversations-container__conversations-list") ||
      document.querySelector(".msg-conversations-container") ||
      document.querySelector("a[href*='/messaging/thread/']")
    ) {
      await sleep(600);
      if (countMessagingConversationItems() > 0) return true;
      // Conteneur présent avec noms même si structure li différente
      if (document.querySelectorAll(".msg-conversation-listitem__participant-names").length > 0) {
        return true;
      }
    }
    await sleep(400);
  }
  return (
    countMessagingConversationItems() > 0 ||
    document.querySelectorAll(".msg-conversation-listitem__participant-names").length > 0
  );
}

/** Scroll la liste de messages jusqu'à stabilisation */
export async function scrollMessagingList(maxScrolls = 40): Promise<void> {
  const scrollRoot = findMessagingListScrollRoot();
  let lastCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    if (scrollRoot === document.documentElement || scrollRoot === document.body) {
      window.scrollTo(0, document.body.scrollHeight);
    } else {
      scrollRoot.scrollTop = scrollRoot.scrollHeight;
    }

    await sleep(700);

    const currentCount = countMessagingConversationItems();
    if (currentCount <= lastCount) {
      stableRounds++;
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
      lastCount = currentCount;
    }
  }
}

/** Parse les conversations visibles (noms + liens thread éventuels) */
export function parseMessagingConversationsFromPage(): MessagingConversationEntry[] {
  const results: MessagingConversationEntry[] = [];
  const seen = new Set<string>();

  const addEntry = (entry: MessagingConversationEntry): void => {
    const key = entry.profileUrl ?? entry.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(entry);
  };

  for (const card of getMessagingConversationElements()) {
    const name = participantNameFromConversationCard(card);
    if (!name || isLikelyGroupChatName(name)) continue;
    addEntry({
      name,
      profileUrl: profileUrlFromCard(card),
      threadHref: threadHrefFromCard(card),
      element: card,
    });
  }

  // Filet direct sur les noms participants (si la structure li a changé)
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(
      ".msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names, [class*='participant-names']"
    )
  )) {
    const name = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (!name || name.length < 2 || isLikelyGroupChatName(name)) continue;
    const card =
      (el.closest(".msg-conversation-listitem") as HTMLElement | null) ??
      (el.closest("li") as HTMLElement | null) ??
      el;
    addEntry({
      name,
      profileUrl: profileUrlFromCard(card),
      threadHref: threadHrefFromCard(card),
      element: card,
    });
  }

  // Fallback : liens /in/ partout dans la zone messaging
  const listRoot = findMessagingListRoot();
  for (const anchor of Array.from(listRoot.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']"))) {
    const profileUrl = profileUrlFromHref(anchor.href);
    if (!profileUrl) continue;
    const name =
      participantNameFromConversationCard(
        (anchor.closest("li, [class*='conversation'], [class*='msg-']") as HTMLElement) ?? anchor
      ) ??
      anchor.getAttribute("aria-label")?.trim() ??
      anchor.textContent?.trim() ??
      "";
    const cleanName = name.replace(/\s+/g, " ").trim();
    if (!cleanName || cleanName.length < 2) continue;
    addEntry({ name: cleanName, profileUrl });
  }

  return results;
}

/** @deprecated use parseMessagingConversationsFromPage */
export function parseMessagingThreadsFromPage(): Array<{ name: string; profileUrl: string }> {
  return parseMessagingConversationsFromPage()
    .filter((e): e is MessagingConversationEntry & { profileUrl: string } => !!e.profileUrl)
    .map(({ name, profileUrl }) => ({ name, profileUrl }));
}

/** Ouvre une conversation et extrait l'URL profil du header du thread */
export async function extractProfileFromOpenThread(): Promise<{
  name: string;
  profileUrl: string;
} | null> {
  const selectors = [
    ".msg-thread__link-to-profile[href*='/in/']",
    "[data-control-name='topcard'][href*='/in/']",
    "a[data-control-name='topcard']",
    ".msg-overlay-bubble-header a[href*='/in/']",
    ".msg-entity-lockup a[href*='/in/']",
    ".msg-entity-lockup__entity-title",
    ".msg-title-bar a[href*='/in/']",
    ".msg-thread-title a[href*='/in/']",
    ".msg-thread a[href*='/in/']",
    "main a[href*='/in/']",
    "[class*='msg-thread'] a[href*='/in/']",
  ];

  for (let attempt = 0; attempt < 10; attempt++) {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;

      const link =
        el instanceof HTMLAnchorElement
          ? el
          : el.closest("a[href*='/in/']") ?? el.querySelector("a[href*='/in/']");
      const href =
        (link instanceof HTMLAnchorElement ? link.href : null) ||
        (el instanceof HTMLAnchorElement ? el.href : null);
      const profileUrl = href ? profileUrlFromHref(href) : null;
      if (!profileUrl) continue;

      const name =
        cleanParticipantName(
          el.getAttribute("aria-label")?.trim() ||
            el.textContent?.trim().replace(/\s+/g, " ") ||
            ""
        ) ||
        profileUrl.split("/in/")[1] ||
        "Unknown";

      return { name, profileUrl };
    }
    await sleep(400);
  }

  return null;
}

export interface CollectMessagingOptions {
  maxThreadOpens?: number;
  /** Si false, n'ouvre pas le thread (ex. déjà matché par nom). Défaut: ouvrir. */
  shouldOpenThread?: (name: string) => boolean;
}

/**
 * Collecte les participants : match liste + ouverture des threads sans /in/.
 * maxThreadOpens limite le nombre de clics (perf).
 */
export async function collectMessagingParticipantsForSync(
  options: CollectMessagingOptions | number = {}
): Promise<Array<{ name: string; profileUrl: string }>> {
  const opts: CollectMessagingOptions =
    typeof options === "number" ? { maxThreadOpens: options } : options;
  const maxThreadOpens = opts.maxThreadOpens ?? 60;
  const shouldOpenThread = opts.shouldOpenThread ?? (() => true);

  await waitForMessagingList();
  await scrollMessagingList();

  const entries = parseMessagingConversationsFromPage();
  console.log(`[LK Tracker] ${entries.length} entrées conversation parsées`);

  const results: Array<{ name: string; profileUrl: string }> = [];
  const seenUrls = new Set<string>();

  const add = (name: string, profileUrl: string): void => {
    if (seenUrls.has(profileUrl)) return;
    seenUrls.add(profileUrl);
    results.push({ name, profileUrl });
  };

  for (const entry of entries) {
    if (entry.profileUrl) add(entry.name, entry.profileUrl);
  }

  // Ouvrir les threads sans lien profil pour récupérer /in/
  let opened = 0;
  for (const entry of entries) {
    if (entry.profileUrl) continue;
    if (!shouldOpenThread(entry.name)) continue;
    if (opened >= maxThreadOpens) break;
    if (!entry.element) continue;

    try {
      clickConversationCard(entry.element);
      opened++;
      await sleep(900);

      const extracted = await extractProfileFromOpenThread();
      if (extracted) add(extracted.name || entry.name, extracted.profileUrl);
    } catch (err) {
      console.warn("[LK Tracker] Ouverture thread échouée:", err);
    }
  }

  // Dernier filet : tous les /in/ visibles après navigation
  for (const anchor of Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']")
  )) {
    if (!anchor.href || anchor.href.includes("/company/")) continue;
    const profileUrl = profileUrlFromHref(anchor.href);
    if (!profileUrl) continue;
    const name =
      anchor.getAttribute("aria-label")?.trim() ||
      anchor.textContent?.trim().replace(/\s+/g, " ") ||
      profileUrl.split("/in/")[1] ||
      "";
    if (name.length >= 2) add(name, profileUrl);
  }

  return results;
}
