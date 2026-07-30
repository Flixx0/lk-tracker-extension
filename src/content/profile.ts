import {
  extractProfileData,
  extractVanityFromConnectElement,
  extractJobTitle,
  extractJobTitleNearElement,
  findActionFromClick,
  findActiveProfileUrl,
  findConnectInviteAnchor,
  findSendWithoutNoteElements,
  getElementLabel,
  isAwaitingSendClickTarget,
  isConnectLabel,
  isCustomInvitePage,
  isLikelySendInviteClick,
  isSendInviteLabel,
  parseNameFromInviteLabel,
  sleep,
} from "../shared/linkedin-dom";
import { setAwaitingSendFlag } from "../shared/awaiting-flag";
import {
  markInvitationToastIfNew,
  parseNameFromInvitationToast,
} from "../shared/invitation-toast";
import {
  isContextInvalidatedError,
  isExtensionContextValid,
} from "../shared/extension-context";
import { logActivity } from "../shared/log-activity";
import { showToast } from "../shared/toast";
import {
  clearPendingInvite,
  getPendingInvite,
  savePendingInvite,
} from "../shared/pending-invite";
import type { ExtensionMessage, PendingInvite, Prospect } from "../shared/types";
import { safeSendToBackground } from "../shared/messaging";

function bg<T>(message: ExtensionMessage): Promise<T | null> {
  return safeSendToBackground<T>(message, stopProfileTracking);
}

let cachedTrackingEnabled: boolean | null = null;
let trackingCacheTime = 0;

let profileTrackingStopped = false;
let domObserver: MutationObserver | null = null;
let lastContextRefresh = 0;

let pendingInviteCache: PendingInvite | null = null;
let pendingInviteCacheTime = 0;

interface ProfileSnapshot {
  name?: string;
  jobTitle?: string;
  location?: string;
  profilePicture?: string;
}

const profileSnapshotCache = new Map<string, ProfileSnapshot>();

function cacheProfileSnapshot(profileUrl: string): void {
  const full = extractProfileData();
  const jobTitle = extractJobTitle() || full?.jobTitle;
  if (!full?.name && !jobTitle) return;

  profileSnapshotCache.set(profileUrl, {
    name: full?.name,
    jobTitle,
    location: full?.location,
    profilePicture: full?.profilePicture,
  });

  if (jobTitle) {
    console.log("[LK Tracker] Poste capturé sur profil:", jobTitle.slice(0, 60));
  } else {
    console.log("[LK Tracker] Poste non détecté sur profil");
  }
}

function getProfileSnapshot(profileUrl: string): ProfileSnapshot | undefined {
  return profileSnapshotCache.get(profileUrl);
}

let contextWatchInterval: ReturnType<typeof setInterval> | null = null;

function stopProfileTracking(): void {
  if (profileTrackingStopped) return;
  profileTrackingStopped = true;
  domObserver?.disconnect();
  domObserver = null;
  domObserverAttached = false;
  if (contextWatchInterval) {
    clearInterval(contextWatchInterval);
    contextWatchInterval = null;
  }
  setAwaitingSendFlag(false);
  showToast("LK Tracker rechargé — rafraîchis la page LinkedIn (F5)", true);
  console.warn("[LK Tracker] Contexte invalide — rafraîchis la page LinkedIn");
}

async function isTrackingEnabled(): Promise<boolean> {
  if (!isExtensionContextValid()) {
    stopProfileTracking();
    return false;
  }
  if (cachedTrackingEnabled !== null && Date.now() - trackingCacheTime < 3000) {
    return cachedTrackingEnabled;
  }
  try {
    const settings = await bg<{ trackingEnabled: boolean }>({ type: "GET_SETTINGS" });
    if (!settings) return false;
    cachedTrackingEnabled = settings.trackingEnabled;
    trackingCacheTime = Date.now();
    return cachedTrackingEnabled;
  } catch {
    return false;
  }
}

async function getPendingInviteCached(): Promise<PendingInvite | null> {
  if (Date.now() - pendingInviteCacheTime < 2000) return pendingInviteCache;
  pendingInviteCache = await getPendingInvite();
  pendingInviteCacheTime = Date.now();
  return pendingInviteCache;
}

async function isWatchingForSend(): Promise<boolean> {
  if (awaitingSendClick) return true;
  const pending = await getPendingInviteCached();
  return pending !== null;
}

let recordedForProfile = false;
let recordingInProgress = false;
let awaitingSendClick = false;
let currentProfileUrl: string | null = null;
let lastNotifiedProfile: string | null = null;
let clickListenerAttached = false;
let domObserverAttached = false;
let pageBridgeListenerAttached = false;

function isRelevantPage(): boolean {
  return location.pathname.includes("/in/") || isCustomInvitePage();
}

function startContextWatch(): void {
  if (contextWatchInterval) return;
  contextWatchInterval = setInterval(() => {
    if (!isExtensionContextValid()) stopProfileTracking();
  }, 1500);
}

function resetProfileState(): void {
  recordedForProfile = false;
  recordingInProgress = false;
  awaitingSendClick = false;
  pendingInviteCache = null;
  pendingInviteCacheTime = 0;
  setAwaitingSendFlag(false);
  clearSendButtonBindings();
}

async function refreshProfileContext(): Promise<void> {
  if (profileTrackingStopped || !isExtensionContextValid()) {
    stopProfileTracking();
    return;
  }

  const now = Date.now();
  if (now - lastContextRefresh < 500) return;
  lastContextRefresh = now;

  try {
    const profileUrl = findActiveProfileUrl();
    const pending = await getPendingInviteCached();

    if (!profileUrl) {
      lastNotifiedProfile = null;
      return;
    }

    if (profileUrl !== currentProfileUrl) {
      if (pending?.profileUrl === profileUrl) {
        currentProfileUrl = profileUrl;
        awaitingSendClick = true;
        setAwaitingSendFlag(true);
      } else {
        if (pending) {
          await clearPendingInvite();
          pendingInviteCache = null;
        }
        currentProfileUrl = profileUrl;
        resetProfileState();
      }
    }

    const tracking = await isTrackingEnabled();
    if (!tracking) return;

    if (isCustomInvitePage() && lastNotifiedProfile !== profileUrl) {
      lastNotifiedProfile = profileUrl;
      awaitingSendClick = true;
      setAwaitingSendFlag(true);
      console.log("[LK Tracker] Page custom-invite", profileUrl);
      return;
    }

    const onProfilePage = location.pathname.includes("/in/");
    if (onProfilePage && lastNotifiedProfile !== profileUrl) {
      lastNotifiedProfile = profileUrl;
      cacheProfileSnapshot(profileUrl);

      if (window === window.top) {
        const snap = getProfileSnapshot(profileUrl);
        const slug = profileUrl.split("/in/")[1]?.replace(/\/$/, "") ?? "profil";
        const name = snap?.name ?? slug;
        const job = snap?.jobTitle?.trim() || "poste non détecté";
        const loc = snap?.location?.trim();
        const details = loc ? `${job} · ${loc}` : job;
        await logActivity(`${name} · ${details}`, "LK Tracker — profil surveillé");
      }

      console.log("[LK Tracker] Profil surveillé", profileUrl);
    }
  } catch (err) {
    if (isContextInvalidatedError(err)) {
      stopProfileTracking();
    } else {
      console.error("[LK Tracker] refreshProfileContext:", err);
    }
  }
}

async function recordInvitation(reason: string): Promise<void> {
  if (recordedForProfile || recordingInProgress) return;
  if (!(await isTrackingEnabled())) return;

  recordingInProgress = true;

  const pending = await getPendingInviteCached();
  let profileData = extractProfileData();

  if (!profileData && pending) {
    profileData = {
      name: pending.name ?? pending.vanityName,
      profileUrl: pending.profileUrl,
      jobTitle: pending.jobTitle,
      profilePicture: pending.profilePicture,
    };
  }

  if (!profileData && invitationToastHint) {
    const profileUrl =
      currentProfileUrl ?? findActiveProfileUrl() ?? pending?.profileUrl;
    if (profileUrl) {
      profileData = {
        name: invitationToastHint,
        profileUrl,
        jobTitle: pending?.jobTitle,
        profilePicture: pending?.profilePicture,
      };
    }
  }

  if (!profileData) {
    recordingInProgress = false;
    await logActivity("Impossible de lire le profil (nom introuvable)", "LK Tracker — erreur", true);
    console.warn("[LK Tracker] extractProfileData failed");
    return;
  }

  // Complète poste / photo depuis pending ou cache profil.
  // Important: ne pas laisser un mauvais scrape de page (modale / liste) écraser
  // un titre déjà capturé correctement au moment du clic « Se connecter ».
  const cached = getProfileSnapshot(profileData.profileUrl);
  const vanity = profileData.profileUrl.split("/in/")[1]?.replace(/\/$/, "");
  const onOwnProfile =
    !!vanity &&
    (location.pathname.includes(`/in/${vanity}`) || location.pathname.includes(`/in/${vanity}/`));

  const preferredTitle =
    pending?.jobTitle?.trim() ||
    cached?.jobTitle?.trim() ||
    (onOwnProfile ? profileData.jobTitle?.trim() : "") ||
    "";

  if (preferredTitle) {
    profileData.jobTitle = preferredTitle;
  } else if (!profileData.jobTitle && onOwnProfile) {
    const scraped = extractJobTitle();
    if (scraped) profileData.jobTitle = scraped;
  }

  if (!profileData.profilePicture && pending?.profilePicture) {
    profileData.profilePicture = pending.profilePicture;
  }
  if (!profileData.profilePicture && cached?.profilePicture) {
    profileData.profilePicture = cached.profilePicture;
  }

  console.log("[LK Tracker] Données prospect:", {
    name: profileData.name,
    jobTitle: profileData.jobTitle ?? "(vide)",
    profileUrl: profileData.profileUrl,
  });

  try {
    const prospect = await bg<Prospect>({
      type: "ADD_PROSPECT",
      payload: {
        id: profileData.profileUrl.split("/in/")[1]?.replace(/\/$/, "") ?? crypto.randomUUID(),
        name: profileData.name,
        profileUrl: profileData.profileUrl,
        profilePicture: profileData.profilePicture,
        jobTitle: profileData.jobTitle,
        status: "invitation_envoyee",
        invitationSentAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    if (!prospect) {
      throw new Error("Extension indisponible — rafraîchis la page (F5)");
    }

    recordedForProfile = true;
    awaitingSendClick = false;
    pendingInviteCache = null;
    setAwaitingSendFlag(false);
    await clearPendingInvite();
    await logActivity(`Prospect enregistré : ${prospect.name} (${reason})`, "LK Tracker — invitation");
    console.log("[LK Tracker] Prospect enregistré:", prospect);
  } catch (err) {
    await logActivity(
      `Erreur : ${err instanceof Error ? err.message : String(err)}`,
      "LK Tracker — erreur",
      true
    );
    console.error("[LK Tracker] Erreur enregistrement:", err);
  } finally {
    recordingInProgress = false;
    invitationToastHint = null;
  }
}

let invitationToastHint: string | null = null;
let lastSendDetectedAt = 0;

async function onSendDetected(
  source: string,
  options?: { requireWatch?: boolean }
): Promise<void> {
  const now = Date.now();
  if (now - lastSendDetectedAt < 2000) return;
  lastSendDetectedAt = now;

  if (recordedForProfile || recordingInProgress) return;
  if (!(await isTrackingEnabled())) return;

  const requireWatch = options?.requireWatch ?? true;
  if (requireWatch && !(await isWatchingForSend())) return;

  console.log("[LK Tracker] Envoi détecté:", source, frameLabel());
  awaitingSendClick = false;
  setAwaitingSendFlag(false);
  await logActivity("Envoi d'invitation…", "LK Tracker", false, true);
  setTimeout(() => recordInvitation(source), 400);
}

async function onInvitationToast(text: string): Promise<void> {
  if (recordedForProfile || recordingInProgress) return;
  if (!markInvitationToastIfNew(text)) return;

  const name = parseNameFromInvitationToast(text);
  if (name) invitationToastHint = name;

  console.log("[LK Tracker] Toast invitation (1x):", text.slice(0, 80));
  await onSendDetected("toast LinkedIn", { requireWatch: false });
}

async function onSendButtonBoundClick(): Promise<void> {
  await onSendDetected("Envoyer sans note (listener direct)");
}

function bindSendInviteButtons(): void {
  if (!awaitingSendClick && !pendingInviteCache) return;
  if (recordedForProfile) return;

  for (const clickable of findSendWithoutNoteElements()) {
    if (clickable.dataset.lkSendBound) continue;
    clickable.dataset.lkSendBound = "true";
    clickable.addEventListener(
      "click",
      () => {
        onSendButtonBoundClick().catch((err) => console.error("[LK Tracker]", err));
      },
      true
    );
    console.log(
      "[LK Tracker] Bouton « Envoyer sans note » lié:",
      clickable.tagName,
      getElementLabel(clickable).slice(0, 50),
      frameLabel()
    );
  }
}

function clearSendButtonBindings(): void {
  document.querySelectorAll<HTMLElement>("[data-lk-send-bound]").forEach((el) => {
    delete el.dataset.lkSendBound;
  });
}

async function handleConnectClick(action: { element: HTMLElement; labels: string[] }): Promise<void> {
  const vanityName = extractVanityFromConnectElement(action.element);
  const inviteLabel = action.labels.find((l) => l.includes("Inviter"));
  const parsedName = inviteLabel ? parseNameFromInviteLabel(inviteLabel) : null;

  if (vanityName) {
    const profileUrl = `https://www.linkedin.com/in/${vanityName}`;
    const snapshot = extractProfileData();
    const cached = getProfileSnapshot(profileUrl);
    const onOwnProfile =
      location.pathname.includes(`/in/${vanityName}`) ||
      location.pathname.includes(`/in/${vanityName}/`);

    // Priorité: carte cliquée (liste) → snapshot profil → extract global (uniquement si on est sur le profil).
    const fromCard = extractJobTitleNearElement(action.element, parsedName ?? undefined);
    const jobTitle =
      fromCard ||
      cached?.jobTitle ||
      (onOwnProfile ? extractJobTitle() || snapshot?.jobTitle : undefined) ||
      snapshot?.jobTitle;

    const pending: PendingInvite = {
      vanityName,
      profileUrl,
      name: parsedName ?? snapshot?.name ?? cached?.name ?? undefined,
      jobTitle,
      profilePicture: snapshot?.profilePicture ?? cached?.profilePicture,
    };
    console.log("[LK Tracker] Pending snapshot poste:", jobTitle ?? "(vide)");
    await savePendingInvite(pending);
    pendingInviteCache = pending;
    pendingInviteCacheTime = Date.now();
    currentProfileUrl = profileUrl;
    awaitingSendClick = true;
    setAwaitingSendFlag(true);
    await logActivity(
      `Prêt — clique « Envoyer sans note » pour ${parsedName ?? vanityName}`,
      "LK Tracker",
      false,
      true
    );
    console.log("[LK Tracker] Pending invite saved", vanityName, frameLabel());
    scheduleSendButtonBinding();
    attachDomObserver();
    return;
  }

  await refreshProfileContext();
  awaitingSendClick = true;
  setAwaitingSendFlag(true);
  const shown = action.labels.find((l) => isConnectLabel(l)) ?? "Se connecter";
  await logActivity(`« ${shown.slice(0, 30)} » — clique Envoyer sans note`, "LK Tracker", false, true);
  scheduleSendButtonBinding();
  attachDomObserver();
}

function scheduleSendButtonBinding(): void {
  setTimeout(() => bindSendInviteButtons(), 200);
  setTimeout(() => bindSendInviteButtons(), 800);
  setTimeout(() => bindSendInviteButtons(), 2000);
  setTimeout(() => bindSendInviteButtons(), 4000);
}

function frameLabel(): string {
  return window === window.top ? "top" : `iframe:${location.pathname}`;
}

async function handleUserPointer(event: Event): Promise<void> {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (!(await isTrackingEnabled())) return;
  if (!(await isWatchingForSend())) return;

  if (isLikelySendInviteClick(target, true) || isAwaitingSendClickTarget(target)) {
    await onSendDetected(`pointer (${event.type})`);
    return;
  }

  const action = findActionFromClick(target);
  if (!action) return;

  const candidates = action.labels;
  const isInviteLink = findConnectInviteAnchor(target) !== null;
  const sendMatch = candidates.some((l) => isSendInviteLabel(l));
  const connectMatch =
    isInviteLink || candidates.some((l) => isConnectLabel(l) && l.length <= 80);

  if (sendMatch) {
    await onSendDetected("label sendMatch");
    return;
  }

  if (!connectMatch) return;
  if (awaitingSendClick && !isInviteLink) return;

  console.log("[LK Tracker] Clic action:", {
    frame: frameLabel(),
    targetTag: target.tagName,
    isInviteLink,
    labels: candidates.map((l) => l.slice(0, 80)),
    sendMatch,
    connectMatch,
  });

  if (connectMatch) {
    await handleConnectClick(action);
  }
}

function handleDocumentClick(event: Event): void {
  handleUserPointer(event).catch((err) => {
    if (isContextInvalidatedError(err)) stopProfileTracking();
  });
}

function attachDomObserver(): void {
  if (domObserverAttached || !document.body || profileTrackingStopped) return;
  if (!isRelevantPage() && !awaitingSendClick && !pendingInviteCache) return;

  domObserver = new MutationObserver(() => {
    if (profileTrackingStopped || !isExtensionContextValid()) {
      stopProfileTracking();
      return;
    }
    if (awaitingSendClick || pendingInviteCache) {
      bindSendInviteButtons();
    }
    if (awaitingSendClick || isRelevantPage()) {
      void refreshProfileContext();
    }
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
  domObserverAttached = true;
}

function installPageBridgeListeners(): void {
  if (pageBridgeListenerAttached || window !== window.top) return;
  pageBridgeListenerAttached = true;

  document.addEventListener("lk-send-invite-click", () => {
    onSendDetected("page bridge click").catch((err) => {
      if (isContextInvalidatedError(err)) stopProfileTracking();
    });
  });

  document.addEventListener("lk-invitation-api", () => {
    onSendDetected("page bridge API", { requireWatch: false }).catch((err) => {
      if (isContextInvalidatedError(err)) stopProfileTracking();
    });
  });

  document.addEventListener("lk-invitation-toast", ((event: Event) => {
    const text = (event as CustomEvent<{ text?: string }>).detail?.text;
    if (!text) return;
    onInvitationToast(text).catch((err) => {
      if (isContextInvalidatedError(err)) stopProfileTracking();
    });
  }) as EventListener);
}

function installProfileMessageListener(): void {
  if (profileMessageListenerAttached) return;
  profileMessageListenerAttached = true;

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type !== "GET_CURRENT_PROFILE") return;

    void (async () => {
      // Scroll léger pour charger les sections lazy (À propos, Expérience)
      window.scrollTo(0, document.body.scrollHeight * 0.45);
      await sleep(450);
      window.scrollTo(0, 0);
      await sleep(250);
      sendResponse(extractProfileData());
    })();

    return true;
  });
}

let profileMessageListenerAttached = false;

export function initProfileTracking(): void {
  if (profileTrackingStopped) return;

  if (window === window.top) {
    installProfileMessageListener();
  }

  startContextWatch();
  installPageBridgeListeners();

  if (!clickListenerAttached) {
    document.addEventListener("click", handleDocumentClick, true);
    clickListenerAttached = true;
    console.log("[LK Tracker] Écoute des clics active", frameLabel());
  }

  const attachDomObserverIfNeeded = attachDomObserver;

  getPendingInviteCached()
    .then((pending) => {
      if (pending) {
        awaitingSendClick = true;
        setAwaitingSendFlag(true);
        console.log("[LK Tracker] Pending invite restauré", pending.vanityName, frameLabel());
        scheduleSendButtonBinding();
      }
      attachDomObserverIfNeeded();
    })
    .catch(() => {});

  attachDomObserverIfNeeded();

  if (isRelevantPage()) {
    void refreshProfileContext();
  }
}
