import type { AppSettings, DetectedProfile, ExtensionMessage, Prospect } from "../shared/types";
import { STATUS_LABELS } from "../shared/types";

function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

const toggle = document.getElementById("tracking-toggle") as HTMLInputElement;
const toggleLabel = document.getElementById("toggle-label")!;
const syncBtn = document.getElementById("sync-connections")!;
const exportBtn = document.getElementById("export-excel")!;
const followUpInput = document.getElementById("follow-up-days") as HTMLInputElement;
const prospectList = document.getElementById("prospect-list")!;
const prospectCount = document.getElementById("prospect-count")!;
const statusMessage = document.getElementById("status-message")!;
const spreadsheetInput = document.getElementById("spreadsheet-id") as HTMLInputElement;
const sheetTabInput = document.getElementById("sheet-tab-name") as HTMLInputElement;
const googleConnectBtn = document.getElementById("google-connect") as HTMLButtonElement;
const googleDisconnectBtn = document.getElementById("google-disconnect") as HTMLButtonElement;
const sheetsStatus = document.getElementById("sheets-status")!;

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
  if (chrome.sidePanel?.open) {
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

function renderProspects(prospects: Prospect[]): void {
  cachedProspects = prospects;
  prospectCount.textContent = String(prospects.length);
  prospectList.innerHTML = "";

  const sorted = [...prospects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  for (const prospect of sorted.slice(0, 20)) {
    const li = document.createElement("li");
    li.className = "prospect-item";

    const body = document.createElement("div");
    body.className = "prospect-body";
    body.innerHTML = `
      <div class="prospect-name">${escapeHtml(prospect.name)}</div>
      <div class="prospect-meta">${escapeHtml(prospect.jobTitle ?? "")}</div>
      <span class="prospect-status">${escapeHtml(STATUS_LABELS[prospect.status] ?? prospect.status)}</span>
    `;

    li.appendChild(createProspectAvatar(prospect.profilePicture));
    li.appendChild(body);
    prospectList.appendChild(li);
  }

  if (currentDetectedProfile) {
    renderDetectedProfile(currentDetectedProfile);
  }
}

function updateSheetsUI(settings: AppSettings): void {
  if (settings.spreadsheetId) {
    spreadsheetInput.value = settings.spreadsheetId;
  }
  sheetTabInput.value = settings.sheetTabName;

  if (settings.googleConnected && settings.sheetsSyncEnabled) {
    sheetsStatus.textContent = `Connecté — sync active`;
    sheetsStatus.classList.add("connected");
    googleConnectBtn.hidden = true;
    googleDisconnectBtn.hidden = false;
  } else {
    sheetsStatus.textContent = "Non connecté";
    sheetsStatus.classList.remove("connected");
    googleConnectBtn.hidden = false;
    googleDisconnectBtn.hidden = true;
  }
}

async function loadSettings(): Promise<void> {
  const settings = await sendMessage<AppSettings>({ type: "GET_SETTINGS" });
  toggle.checked = settings.trackingEnabled;
  toggleLabel.textContent = settings.trackingEnabled ? "On" : "Off";
  followUpInput.value = String(settings.followUpDays);
  updateSheetsUI(settings);
}

async function loadProspects(): Promise<void> {
  const prospects = await sendMessage<Prospect[]>({ type: "GET_PROSPECTS" });
  renderProspects(prospects);
}

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

googleConnectBtn.addEventListener("click", async () => {
  const spreadsheetId = spreadsheetInput.value.trim();
  if (!spreadsheetId) {
    showStatus("Colle l'URL du Google Sheet", true);
    return;
  }

  googleConnectBtn.disabled = true;
  try {
    const result = await sendMessage<{ title: string; tabName: string; synced: number }>({
      type: "GOOGLE_CONNECT",
      payload: {
        spreadsheetId,
        sheetTabName: sheetTabInput.value.trim() || "Feuille 1",
      },
    });
    showStatus(`Connecté à « ${result.title} » (onglet: ${result.tabName}, ${result.synced} lignes)`);
    await loadSettings();
  } catch (err) {
    showStatus(`Erreur: ${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    googleConnectBtn.disabled = false;
  }
});

googleDisconnectBtn.addEventListener("click", async () => {
  await sendMessage({ type: "GOOGLE_DISCONNECT" });
  showStatus("Google déconnecté");
  await loadSettings();
});

syncBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ lkPendingConnectionsSync: true });

  const tab = await chrome.tabs.create({
    url: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
    active: true,
  });

  if (!tab.id) return;
  showStatus("Sync connexions en cours…");

  const tabId = tab.id;
  const triggerSync = async (): Promise<boolean> => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "TRIGGER_CONNECTIONS_SYNC" });
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
        showStatus("Page ouverte — sync auto dans quelques secondes");
        return;
      }
      setTimeout(() => retry(attempt + 1), 1500);
    };

    setTimeout(() => retry(0), 2000);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
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
    const { updated } = message.payload as { updated: number };
    showStatus(`${updated} prospect(s) marqué(s) connecté(s)`);
    loadProspects();
  }
});

loadSettings();
loadProspects();
refreshDetectedProfile();

openPanelWindowBtn.addEventListener("click", async () => {
  openPanelWindowBtn.disabled = true;
  try {
    // Ouvre la fenêtre depuis le popup (plus fiable qu'via le SW, surtout sur Arc)
    const KEY = "lkPanelWindowId";
    const stored = await chrome.storage.local.get(KEY);
    const existingId = stored[KEY] as number | undefined;

    if (existingId) {
      try {
        await chrome.windows.update(existingId, {
          focused: true,
          width: 420,
          height: 720,
          state: "normal",
        });
        window.close();
        return;
      } catch {
        await chrome.storage.local.remove(KEY);
      }
    }

    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?mode=window"),
      type: "normal",
      width: 420,
      height: 720,
      focused: true,
    });

    if (win.id) {
      await chrome.storage.local.set({ [KEY]: win.id });
      await chrome.windows.update(win.id, { width: 420, height: 720, state: "normal" });
    }
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
