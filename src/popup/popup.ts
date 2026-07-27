import type { AppSettings, ExtensionMessage, Prospect } from "../shared/types";
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

function showStatus(text: string, isError = false): void {
  statusMessage.textContent = text;
  statusMessage.hidden = false;
  statusMessage.classList.toggle("error", isError);
  setTimeout(() => {
    statusMessage.hidden = true;
  }, 4000);
}

function renderProspects(prospects: Prospect[]): void {
  prospectCount.textContent = String(prospects.length);
  prospectList.innerHTML = "";

  const sorted = [...prospects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  for (const prospect of sorted.slice(0, 20)) {
    const li = document.createElement("li");
    li.className = "prospect-item";
    li.innerHTML = `
      <div class="prospect-name">${escapeHtml(prospect.name)}</div>
      <div class="prospect-meta">${escapeHtml(prospect.jobTitle ?? "")}</div>
      <span class="prospect-status">${escapeHtml(STATUS_LABELS[prospect.status] ?? prospect.status)}</span>
    `;
    prospectList.appendChild(li);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
