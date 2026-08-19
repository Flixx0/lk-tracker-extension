import type { AppSettings, DetectedProfile, ExtensionMessage, FirstMessageType, Prospect, ProspectStatus } from "../shared/types";
import { PROSPECT_STATUSES, STATUS_LABELS } from "../shared/types";
import { formatProfileForAi } from "../shared/profile-ai-export";

function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (
      response &&
      typeof response === "object" &&
      "error" in response &&
      (response as { error?: unknown }).error
    ) {
      throw new Error(String((response as { error: unknown }).error));
    }
    return response as T;
  });
}

const toggle = document.getElementById("tracking-toggle") as HTMLInputElement;
const toggleLabel = document.getElementById("toggle-label")!;
const syncBtn = document.getElementById("sync-connections")!;
const syncMessagesWeekBtn = document.getElementById("sync-messages-week")!;
const syncMessagesAllBtn = document.getElementById("sync-messages-all")!;
const exportBtn = document.getElementById("export-excel")!;
const followUpInput = document.getElementById("follow-up-days") as HTMLInputElement;
const prospectList = document.getElementById("prospect-list")!;
const prospectCount = document.getElementById("prospect-count")!;
const toContactList = document.getElementById("to-contact-list")!;
const toContactCount = document.getElementById("to-contact-count")!;
const toContactEmpty = document.getElementById("to-contact-empty")!;
const statusMessage = document.getElementById("status-message")!;

const currentProfileSection = document.getElementById("current-profile-section")!;
const noProfileHint = document.getElementById("no-profile-hint")!;
const currentProfilePhoto = document.getElementById("current-profile-photo") as HTMLImageElement;
const currentProfilePhotoPlaceholder = document.getElementById(
  "current-profile-photo-placeholder"
)!;
const currentProfileName = document.getElementById("current-profile-name")!;
const currentProfileJob = document.getElementById("current-profile-job")!;
const currentProfileLocation = document.getElementById("current-profile-location")!;
const addCurrentProfileBtn = document.getElementById("add-current-profile") as HTMLButtonElement;
const copyProfileForAiBtn = document.getElementById("copy-profile-for-ai") as HTMLButtonElement;
const currentProfileHint = document.getElementById("current-profile-hint")!;

const openPanelWindowBtn = document.getElementById("open-panel-window") as HTMLButtonElement;
const openSidePanelBtn = document.getElementById("open-side-panel") as HTMLButtonElement;

const isWindowMode = new URLSearchParams(location.search).get("mode") === "window";

if (isWindowMode) {
  document.body.classList.add("window-mode");
  openPanelWindowBtn.hidden = true;
  openSidePanelBtn.hidden = true;
} else {
  document.body.classList.add("panel-mode");
  if (chrome.sidePanel) {
    openSidePanelBtn.hidden = false;
  }
}

let cachedProspects: Prospect[] = [];
let currentDetectedProfile: DetectedProfile | null = null;

function showStatus(text: string, isError = false): void {
  statusMessage.textContent = text;
  statusMessage.hidden = false;
  statusMessage.classList.toggle("error", isError);
  setTimeout(() => {
    statusMessage.hidden = true;
  }, 4000);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function createProspectAvatar(picture?: string): HTMLElement {
  if (picture?.trim()) {
    const img = document.createElement("img");
    img.className = "prospect-photo";
    img.alt = "";
    img.src = picture;
    img.onerror = () => {
      const placeholder = document.createElement("div");
      placeholder.className = "prospect-photo placeholder";
      img.replaceWith(placeholder);
    };
    return img;
  }

  const placeholder = document.createElement("div");
  placeholder.className = "prospect-photo placeholder";
  return placeholder;
}

function setCurrentProfilePhoto(picture?: string): void {
  currentProfilePhoto.onerror = () => {
    currentProfilePhoto.hidden = true;
    currentProfilePhoto.removeAttribute("src");
    currentProfilePhotoPlaceholder.hidden = false;
  };

  if (picture?.trim()) {
    currentProfilePhoto.src = picture;
    currentProfilePhoto.hidden = false;
    currentProfilePhotoPlaceholder.hidden = true;
  } else {
    currentProfilePhoto.hidden = true;
    currentProfilePhoto.removeAttribute("src");
    currentProfilePhotoPlaceholder.hidden = false;
  }
}

function normalizeProfileUrl(url: string): string {
  try {
    const match = new URL(url).pathname.match(/\/in\/([^/]+)/);
    if (match) return `https://www.linkedin.com/in/${match[1]}`;
    return url.replace(/\/$/, "").split("?")[0];
  } catch {
    return url.replace(/\/$/, "").split("?")[0];
  }
}

function isProfileInList(profileUrl: string): boolean {
  const norm = normalizeProfileUrl(profileUrl);
  return cachedProspects.some((p) => normalizeProfileUrl(p.profileUrl) === norm);
}

function findProspectForProfile(profileUrl: string): Prospect | undefined {
  const norm = normalizeProfileUrl(profileUrl);
  return cachedProspects.find((p) => normalizeProfileUrl(p.profileUrl) === norm);
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function checkProfileInDb(profileUrl: string): Promise<boolean> {
  const result = await sendMessage<{ exists: boolean }>({
    type: "CHECK_PROSPECT_EXISTS",
    payload: { profileUrl },
  });
  return result.exists;
}

async function getLinkedInProfileTab(): Promise<chrome.tabs.Tab | null> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id && activeTab.url?.includes("linkedin.com/in/")) {
    return activeTab;
  }

  const profileTabs = await chrome.tabs.query({ url: "https://www.linkedin.com/in/*" });
  if (profileTabs.length === 0) return null;

  return profileTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

async function fetchDetectedProfile(): Promise<DetectedProfile | null> {
  const tab = await getLinkedInProfileTab();
  if (!tab?.id || !tab.url?.includes("linkedin.com/in/")) return null;

  try {
    const profile = await chrome.tabs.sendMessage(tab.id, { type: "GET_CURRENT_PROFILE" });
    if (!profile?.name || !profile?.profileUrl) return null;
    const detected = profile as DetectedProfile;
    detected.alreadyInDb = await checkProfileInDb(detected.profileUrl);
    return detected;
  } catch {
    return null;
  }
}

function renderDetectedProfile(profile: DetectedProfile | null): void {
  currentDetectedProfile = profile;

  if (!profile) {
    currentProfileSection.hidden = true;
    noProfileHint.hidden = false;
    return;
  }

  noProfileHint.hidden = true;
  currentProfileSection.hidden = false;

  currentProfileName.textContent = profile.name;
  currentProfileJob.textContent = profile.jobTitle?.trim() || "Poste non détecté";
  currentProfileJob.style.color = profile.jobTitle ? "#444" : "#999";

  if (profile.location?.trim()) {
    currentProfileLocation.textContent = profile.location.trim();
    currentProfileLocation.hidden = false;
  } else {
    currentProfileLocation.textContent = "";
    currentProfileLocation.hidden = true;
  }

  setCurrentProfilePhoto(profile.profilePicture);

  const inList = profile.alreadyInDb ?? isProfileInList(profile.profileUrl);
  addCurrentProfileBtn.disabled = inList;
  addCurrentProfileBtn.textContent = inList ? "Déjà dans la liste" : "Ajouter à la liste";

  if (inList) {
    currentProfileHint.textContent = "Ce prospect est déjà enregistré dans la base.";
    currentProfileHint.classList.add("in-list");
    currentProfileHint.hidden = false;
  } else {
    currentProfileHint.hidden = true;
    currentProfileHint.classList.remove("in-list");
  }
}

async function refreshDetectedProfile(): Promise<void> {
  const profile = await fetchDetectedProfile();
  renderDetectedProfile(profile);
}

function isProspectToContact(prospect: Prospect): boolean {
  return (
    prospect.status === PROSPECT_STATUSES.CONNECTED &&
    !prospect.messageSentAt
  );
}

function sortProspectsByDate(prospects: Prospect[]): Prospect[] {
  return [...prospects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function createProspectActions(
  prospect: Prospect,
  options: { showCopyLink?: boolean; showMarkMessage?: boolean } = {}
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "prospect-actions";

  if (options.showCopyLink) {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-prospect-action btn-copy-link";
    copyBtn.title = "Copier le lien du profil";
    copyBtn.setAttribute("aria-label", `Copier le lien de ${prospect.name}`);
    copyBtn.textContent = "⧉";
    copyBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await copyTextToClipboard(prospect.profileUrl);
        showStatus(`Lien copié — ${prospect.name}`);
      } catch {
        showStatus("Erreur lors de la copie du lien", true);
      }
    });
    actions.appendChild(copyBtn);
  }

  if (options.showMarkMessage) {
    const msgBtn = document.createElement("button");
    msgBtn.type = "button";
    msgBtn.className = "btn-prospect-action btn-mark-message";
    msgBtn.title = "Marquer comme message envoyé";
    msgBtn.setAttribute("aria-label", `Message envoyé à ${prospect.name}`);
    msgBtn.textContent = "✉";
    msgBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      msgBtn.disabled = true;
      try {
        const settings = await sendMessage<AppSettings>({ type: "GET_SETTINGS" });
        const now = new Date();
        const followUp = new Date(now);
        followUp.setDate(followUp.getDate() + (settings.followUpDays || 3));

        const updated = await sendMessage<Prospect | null>({
          type: "UPDATE_PROSPECT",
          payload: {
            id: prospect.id,
            patch: {
              status: PROSPECT_STATUSES.MESSAGE_SENT,
              messageSentAt: now.toISOString(),
              followUpDate: followUp.toISOString(),
            },
          },
        });
        if (!updated) {
          showStatus("Prospect introuvable", true);
          msgBtn.disabled = false;
          return;
        }
        showStatus(`${prospect.name} → Message envoyé`);
        await loadProspects();
      } catch (err) {
        showStatus(`Erreur : ${err instanceof Error ? err.message : String(err)}`, true);
        msgBtn.disabled = false;
      }
    });
    actions.appendChild(msgBtn);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn-prospect-action btn-delete-prospect";
  deleteBtn.title = "Supprimer le prospect";
  deleteBtn.setAttribute("aria-label", `Supprimer ${prospect.name}`);
  deleteBtn.textContent = "✕";
  deleteBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Supprimer ${prospect.name} de la liste ?`)) return;

    deleteBtn.disabled = true;
    try {
      const result = await sendMessage<{ ok: boolean }>({
        type: "DELETE_PROSPECT",
        payload: { id: prospect.id },
      });
      if (!result.ok) {
        showStatus("Prospect introuvable", true);
        await loadProspects();
        return;
      }
      showStatus(`${prospect.name} supprimé`);
      await loadProspects();
    } catch (err) {
      showStatus(`Erreur : ${err instanceof Error ? err.message : String(err)}`, true);
      deleteBtn.disabled = false;
    }
  });
  actions.appendChild(deleteBtn);

  return actions;
}

function hasTitleChoices(prospect: Prospect): boolean {
  return (prospect.jobTitleCandidates?.length ?? 0) >= 1;
}

async function chooseJobTitle(prospectId: string, jobTitle: string): Promise<void> {
  await sendMessage({
    type: "UPDATE_PROSPECT",
    payload: {
      id: prospectId,
      patch: {
        jobTitle,
        jobTitleCandidates: [],
      },
    },
  });
  showStatus(`Titre enregistré — ${jobTitle.slice(0, 60)}`);
  await loadProspects();
}

function appendTitleChoices(body: HTMLElement, prospect: Prospect): void {
  if (!hasTitleChoices(prospect)) return;

  const choices = document.createElement("div");
  choices.className = "title-choices";

  const label = document.createElement("div");
  label.className = "title-choices-label";
  label.textContent = "Choisir un titre :";
  choices.appendChild(label);

  for (const title of prospect.jobTitleCandidates ?? []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-title-choice";
    btn.textContent = title;
    btn.title = `Choisir : ${title}`;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      try {
        await chooseJobTitle(prospect.id, title);
      } catch (err) {
        showStatus(`Erreur : ${err instanceof Error ? err.message : String(err)}`, true);
        btn.disabled = false;
      }
    });
    choices.appendChild(btn);
  }

  body.appendChild(choices);
}

function createProspectListItem(
  prospect: Prospect,
  options: { showCopyLink?: boolean; showMarkMessage?: boolean } = {}
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "prospect-item";
  if (hasTitleChoices(prospect)) li.classList.add("has-title-choices");

  const body = document.createElement("div");
  body.className = "prospect-body";

  const nameEl = document.createElement("div");
  nameEl.className = "prospect-name";
  nameEl.textContent = prospect.name;
  body.appendChild(nameEl);

  const metaEl = document.createElement("div");
  metaEl.className = "prospect-meta";
  metaEl.textContent = prospect.jobTitle?.trim() || (hasTitleChoices(prospect) ? "Titre à choisir" : "");
  if (!prospect.jobTitle?.trim() && hasTitleChoices(prospect)) {
    metaEl.classList.add("prospect-meta-pending");
  }
  body.appendChild(metaEl);

  const statusRow = document.createElement("div");
  statusRow.className = "prospect-status-row";

  const statusSelect = document.createElement("select");
  statusSelect.className = "prospect-status-select";
  statusSelect.title = "Changer le statut";
  for (const [, value] of Object.entries(PROSPECT_STATUSES)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = STATUS_LABELS[value] ?? value;
    if (value === prospect.status) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusSelect.addEventListener("change", async () => {
    const newStatus = statusSelect.value as ProspectStatus;
    statusSelect.disabled = true;
    try {
      await sendMessage({
        type: "UPDATE_PROSPECT",
        payload: { id: prospect.id, patch: { status: newStatus } },
      });
      await loadProspects();
    } catch (err) {
      showStatus(`Erreur : ${err instanceof Error ? err.message : String(err)}`, true);
      statusSelect.value = prospect.status;
    } finally {
      statusSelect.disabled = false;
    }
  });
  statusRow.appendChild(statusSelect);

  if (prospect.firstMessageType) {
    const badge = document.createElement("span");
    badge.className = `msg-type-badge msg-type-${prospect.firstMessageType}`;
    badge.textContent = prospect.firstMessageType === "video" ? "🎥" : "💬";
    badge.title = prospect.firstMessageType === "video" ? "Premier message : vidéo" : "Premier message : texte";
    statusRow.appendChild(badge);
  }

  body.appendChild(statusRow);

  appendTitleChoices(body, prospect);

  li.appendChild(createProspectAvatar(prospect.profilePicture));
  li.appendChild(body);
  li.appendChild(createProspectActions(prospect, options));

  return li;
}

function renderProspectList(
  container: HTMLElement,
  prospects: Prospect[],
  options: { showCopyLink?: boolean; showMarkMessage?: boolean; limit?: number } = {}
): void {
  container.innerHTML = "";
  const items = options.limit ? prospects.slice(0, options.limit) : prospects;
  for (const prospect of items) {
    container.appendChild(createProspectListItem(prospect, options));
  }
}

function renderStats(prospects: Prospect[]): void {
  const statsContent = document.getElementById("stats-content");
  if (!statsContent) return;

  const total = prospects.length;
  const byStatus: Record<string, number> = {};
  let videoCount = 0;
  let textCount = 0;
  let msgSentCount = 0;

  for (const p of prospects) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    if (p.messageSentAt) {
      msgSentCount++;
      if (p.firstMessageType === "video") videoCount++;
      else if (p.firstMessageType === "text") textCount++;
    }
  }

  const statusLines = Object.entries(PROSPECT_STATUSES)
    .map(([, val]) => {
      const count = byStatus[val] ?? 0;
      const label = STATUS_LABELS[val] ?? val;
      return `<div class="stat-row"><span>${label}</span><strong>${count}</strong></div>`;
    })
    .join("");

  const unknownMsg = msgSentCount - videoCount - textCount;

  statsContent.innerHTML = `
    <div class="stat-section">
      <div class="stat-title">Par statut</div>
      ${statusLines}
      <div class="stat-row stat-total"><span>Total</span><strong>${total}</strong></div>
    </div>
    <div class="stat-section">
      <div class="stat-title">1er message envoyé</div>
      <div class="stat-row"><span>🎥 Vidéo</span><strong>${videoCount}</strong></div>
      <div class="stat-row"><span>💬 Texte</span><strong>${textCount}</strong></div>
      ${unknownMsg > 0 ? `<div class="stat-row"><span>❓ Non détecté</span><strong>${unknownMsg}</strong></div>` : ""}
      <div class="stat-row stat-total"><span>Total messages envoyés</span><strong>${msgSentCount}</strong></div>
      ${msgSentCount > 0 && (videoCount + textCount) > 0 ? `
        <div class="stat-bar">
          <div class="stat-bar-video" style="width: ${(videoCount / (videoCount + textCount) * 100).toFixed(0)}%"
            title="${videoCount} vidéo${videoCount > 1 ? "s" : ""}"></div>
          <div class="stat-bar-text" style="width: ${(textCount / (videoCount + textCount) * 100).toFixed(0)}%"
            title="${textCount} texte${textCount > 1 ? "s" : ""}"></div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderProspects(prospects: Prospect[]): void {
  cachedProspects = prospects;
  prospectCount.textContent = String(prospects.length);

  const sorted = sortProspectsByDate(prospects);
  const toContact = sorted.filter(isProspectToContact);

  toContactCount.textContent = String(toContact.length);
  toContactEmpty.hidden = toContact.length > 0;
  renderProspectList(toContactList, toContact, { showCopyLink: true, showMarkMessage: true });
  renderProspectList(prospectList, sorted, { limit: 50 });

  renderStats(prospects);

  if (currentDetectedProfile) {
    renderDetectedProfile(currentDetectedProfile);
  }
}

async function loadSettings(): Promise<void> {
  const settings = await sendMessage<AppSettings>({ type: "GET_SETTINGS" });
  toggle.checked = settings.trackingEnabled;
  toggleLabel.textContent = settings.trackingEnabled ? "On" : "Off";
  followUpInput.value = String(settings.followUpDays);
}

async function loadProspects(): Promise<void> {
  const prospects = await sendMessage<Prospect[]>({ type: "GET_PROSPECTS" });
  if (!Array.isArray(prospects)) {
    console.warn("[LK Tracker] GET_PROSPECTS invalide:", prospects);
    return;
  }
  renderProspects(prospects);
}

/** Rafraîchit la liste quand le cache local change (après un upsert Supabase). */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.prospects_cache) return;
  const next = changes.prospects_cache.newValue;
  if (Array.isArray(next)) {
    renderProspects(next as Prospect[]);
  } else {
    loadProspects().catch(() => {});
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadProspects().catch(() => {});
  }
});


copyProfileForAiBtn.addEventListener("click", async () => {
  copyProfileForAiBtn.disabled = true;
  try {
    await refreshDetectedProfile();
    if (!currentDetectedProfile) {
      showStatus("Ouvre un profil LinkedIn (/in/…) pour copier", true);
      return;
    }

    const prospect = findProspectForProfile(currentDetectedProfile.profileUrl);
    const text = formatProfileForAi(currentDetectedProfile, prospect);
    await copyTextToClipboard(text);
    showStatus("Profil copié — prêt à coller dans ton IA");
  } catch (err) {
    showStatus(`Erreur copie : ${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    copyProfileForAiBtn.disabled = false;
  }
});

addCurrentProfileBtn.addEventListener("click", async () => {
  if (!currentDetectedProfile) return;

  const inDb =
    (await checkProfileInDb(currentDetectedProfile.profileUrl)) ||
    isProfileInList(currentDetectedProfile.profileUrl);

  if (inDb) {
    showStatus("Ce prospect est déjà dans la liste", true);
    renderDetectedProfile({ ...currentDetectedProfile, alreadyInDb: true });
    return;
  }

  addCurrentProfileBtn.disabled = true;
  try {
    const now = new Date().toISOString();
    const slug =
      currentDetectedProfile.profileUrl.split("/in/")[1]?.replace(/\/$/, "") ??
      crypto.randomUUID();

    const prospect = await sendMessage<Prospect>({
      type: "ADD_PROSPECT",
      payload: {
        id: slug,
        name: currentDetectedProfile.name,
        profileUrl: currentDetectedProfile.profileUrl,
        profilePicture: currentDetectedProfile.profilePicture,
        jobTitle: currentDetectedProfile.jobTitle,
        status: "invitation_envoyee",
        createdAt: now,
        updatedAt: now,
      },
    });

    showStatus(`${prospect.name} ajouté à la liste`);
    await loadProspects();
  } catch (err) {
    showStatus(`Erreur : ${err instanceof Error ? err.message : String(err)}`, true);
    addCurrentProfileBtn.disabled = false;
  }
});

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  await sendMessage({
    type: "SET_TRACKING",
    payload: { enabled },
  });
  toggleLabel.textContent = enabled ? "On" : "Off";
  showStatus(enabled ? "Tracking activé" : "Tracking désactivé");
});

followUpInput.addEventListener("change", async () => {
  const days = parseInt(followUpInput.value, 10);
  if (days < 1 || days > 30) return;
  await sendMessage({
    type: "SET_SHEET_CONFIG",
    payload: { followUpDays: days },
  });
});


const PANEL_WINDOW_ID_KEY = "lkPanelWindowId";

async function isExtensionPanelWindow(windowId: number): Promise<boolean> {
  const stored = await chrome.storage.local.get(PANEL_WINDOW_ID_KEY);
  if (stored[PANEL_WINDOW_ID_KEY] === windowId) return true;

  // Filet de sécurité Arc : fenêtre qui ne contient que le popup extension
  const tabs = await chrome.tabs.query({ windowId });
  if (tabs.length === 0) return false;
  const extensionOrigin = chrome.runtime.getURL("");
  return tabs.every((tab) => (tab.url ?? tab.pendingUrl ?? "").startsWith(extensionOrigin));
}

/** Fenêtre navigateur « normale » (pas la fenêtre détachée LK Tracker). Critique sur Arc. */
async function findBrowserWindowForSync(): Promise<number | undefined> {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"],
  });

  const candidates: chrome.windows.Window[] = [];
  for (const win of windows) {
    if (win.id == null) continue;
    if (await isExtensionPanelWindow(win.id)) continue;
    candidates.push(win);
  }

  if (candidates.length === 0) return undefined;

  const withLinkedIn = candidates.find((win) =>
    win.tabs?.some((tab) => (tab.url ?? "").includes("linkedin.com"))
  );
  if (withLinkedIn?.id != null) return withLinkedIn.id;

  const focused = candidates.find((win) => win.focused);
  if (focused?.id != null) return focused.id;

  return candidates[0]?.id;
}

async function openOrReuseLinkedInTab(url: string): Promise<chrome.tabs.Tab | null> {
  const windowId = await findBrowserWindowForSync();

  if (windowId != null) {
    const pathHint = url.includes("/messaging")
      ? "https://www.linkedin.com/messaging/*"
      : "https://www.linkedin.com/mynetwork/*";

    const existing = await chrome.tabs.query({ windowId, url: [pathHint] });
    const reusable = existing.find((tab) => tab.id != null);

    if (reusable?.id != null) {
      await chrome.tabs.update(reusable.id, { url, active: true });
      await chrome.windows.update(windowId, { focused: true });
      return reusable;
    }

    const created = await chrome.tabs.create({ url, active: true, windowId });
    await chrome.windows.update(windowId, { focused: true });
    return created;
  }

  // Aucune fenêtre navigateur : en ouvrir une neuve (évite d'injecter LinkedIn dans le panneau)
  const win = await chrome.windows.create({
    url,
    type: "normal",
    focused: true,
  });
  return win.tabs?.[0] ?? null;
}

async function openLinkedInSync(options: {
  pendingKey: string;
  pendingPayload?: Record<string, unknown>;
  url: string;
  triggerType: ExtensionMessage["type"];
  triggerPayload?: Record<string, unknown>;
  statusText: string;
  fallbackText: string;
}): Promise<void> {
  await chrome.storage.local.set({
    [options.pendingKey]: options.pendingPayload ?? true,
  });

  const tab = await openOrReuseLinkedInTab(options.url);
  if (!tab?.id) {
    showStatus("Impossible d'ouvrir LinkedIn pour la sync", true);
    return;
  }

  showStatus(options.statusText);

  const tabId = tab.id;
  const triggerSync = async (): Promise<boolean> => {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: options.triggerType,
        payload: options.triggerPayload,
      });
      return true;
    } catch {
      return false;
    }
  };

  const onUpdated = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
    if (updatedTabId !== tabId || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpdated);

    const retry = async (attempt: number): Promise<void> => {
      if (await triggerSync()) return;
      if (attempt >= 8) {
        showStatus(options.fallbackText);
        return;
      }
      setTimeout(() => retry(attempt + 1), 1500);
    };

    setTimeout(() => retry(0), 2000);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);

  // Onglet déjà sur la bonne page (réutilisé) : onUpdated peut ne pas se déclencher
  const alreadyOnTarget =
    (options.url.includes("/messaging") && (tab.url ?? "").includes("/messaging")) ||
    (options.url.includes("connections") && (tab.url ?? "").includes("connections"));
  if (alreadyOnTarget && tab.status === "complete") {
    setTimeout(() => {
      triggerSync().catch(() => {});
    }, 2500);
  }
}

syncBtn.addEventListener("click", async () => {
  await openLinkedInSync({
    pendingKey: "lkPendingConnectionsSync",
    url: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
    triggerType: "TRIGGER_CONNECTIONS_SYNC",
    statusText: "Sync connexions en cours…",
    fallbackText: "Page ouverte — sync auto dans quelques secondes",
  });
});

syncMessagesWeekBtn.addEventListener("click", async () => {
  await openLinkedInSync({
    pendingKey: "lkPendingMessagesSync",
    pendingPayload: { mode: "week" },
    url: "https://www.linkedin.com/messaging/",
    triggerType: "TRIGGER_MESSAGES_SYNC",
    triggerPayload: { mode: "week" },
    statusText: "Sync messages (7 jours) en cours…",
    fallbackText: "Page ouverte — sync messages auto dans quelques secondes",
  });
});

syncMessagesAllBtn.addEventListener("click", async () => {
  await openLinkedInSync({
    pendingKey: "lkPendingMessagesSync",
    pendingPayload: { mode: "all" },
    url: "https://www.linkedin.com/messaging/",
    triggerType: "TRIGGER_MESSAGES_SYNC",
    triggerPayload: { mode: "all" },
    statusText: "Sync messages (tous) en cours…",
    fallbackText: "Page ouverte — sync messages auto dans quelques secondes",
  });
});

exportBtn.addEventListener("click", async () => {
  try {
    const result = await sendMessage<{ count: number }>({ type: "EXPORT_EXCEL" });
    showStatus(`${result.count} prospects exportés`);
  } catch {
    showStatus("Erreur export", true);
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "CONNECTIONS_SYNC_DONE") {
    const { updated, metaUpdated, titlesPending } = message.payload as {
      updated: number;
      metaUpdated?: number;
      titlesPending?: number;
    };
    const parts = [
      updated > 0 ? `${updated} connecté(s)` : null,
      (metaUpdated ?? 0) > 0 ? `${metaUpdated} photo/titre maj` : null,
      (titlesPending ?? 0) > 0 ? `${titlesPending} titre(s) à choisir` : null,
    ].filter(Boolean);
    showStatus(parts.length > 0 ? parts.join(" · ") : "Aucun prospect à mettre à jour");
    loadProspects();
  }
  if (message.type === "MESSAGES_SYNC_DONE") {
    const { updated } = message.payload as { updated: number };
    showStatus(`${updated} prospect(s) → message envoyé`);
    loadProspects();
  }
});

loadSettings();
loadProspects();
refreshDetectedProfile();

openPanelWindowBtn.addEventListener("click", async () => {
  openPanelWindowBtn.disabled = true;
  try {
    await sendMessage({ type: "OPEN_PANEL_WINDOW" });
    window.close();
  } catch (err) {
    showStatus(`Erreur : ${err instanceof Error ? err.message : String(err)}`, true);
    openPanelWindowBtn.disabled = false;
  }
});

openSidePanelBtn.addEventListener("click", async () => {
  try {
    await sendMessage({ type: "OPEN_SIDE_PANEL" });
  } catch (err) {
    showStatus(`Erreur : ${err instanceof Error ? err.message : String(err)}`, true);
  }
});

const profileRefreshTimer = setInterval(() => {
  refreshDetectedProfile().catch(() => {});
}, 2000);

window.addEventListener("unload", () => clearInterval(profileRefreshTimer));
