const BANNER_ID = "lk-tracker-sync-banner";
const PROGRESS_ID = "lk-tracker-sync-progress";

function getOrCreateBanner(): HTMLElement {
  let banner = document.getElementById(BANNER_ID);
  if (banner) return banner;

  banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:100000",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "gap:10px",
    "padding:8px 16px",
    "font-family:system-ui,sans-serif",
    "font-size:13px",
    "font-weight:500",
    "color:#fff",
    "background:#0a66c2",
    "box-shadow:0 2px 8px rgba(0,0,0,.18)",
    "transition:transform .3s ease, opacity .3s ease",
    "transform:translateY(0)",
    "opacity:1",
  ].join(";");

  const spinner = document.createElement("span");
  spinner.style.cssText = [
    "display:inline-block",
    "width:14px",
    "height:14px",
    "border:2px solid rgba(255,255,255,.3)",
    "border-top-color:#fff",
    "border-radius:50%",
    "animation:lk-spin .7s linear infinite",
    "flex-shrink:0",
  ].join(";");

  const text = document.createElement("span");
  text.id = PROGRESS_ID;
  text.textContent = "Synchronisation en cours…";

  banner.appendChild(spinner);
  banner.appendChild(text);

  if (!document.getElementById("lk-spin-keyframes")) {
    const style = document.createElement("style");
    style.id = "lk-spin-keyframes";
    style.textContent = "@keyframes lk-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
  }

  document.body.appendChild(banner);
  return banner;
}

export function showSyncBanner(message: string): void {
  const banner = getOrCreateBanner();
  const text = banner.querySelector<HTMLElement>(`#${PROGRESS_ID}`);
  if (text) text.textContent = message;
  banner.style.transform = "translateY(0)";
  banner.style.opacity = "1";
  banner.style.display = "flex";
}

export function updateSyncBanner(message: string): void {
  const text = document.getElementById(PROGRESS_ID);
  if (text) text.textContent = message;
}

export function hideSyncBanner(finalMessage?: string, isError = false): void {
  const banner = document.getElementById(BANNER_ID);
  if (!banner) return;

  if (finalMessage) {
    const text = banner.querySelector<HTMLElement>(`#${PROGRESS_ID}`);
    if (text) text.textContent = finalMessage;
    banner.style.background = isError ? "#c41e3a" : "#0a8a4e";
    const spinner = banner.querySelector<HTMLElement>("span:first-child");
    if (spinner) spinner.style.display = "none";

    setTimeout(() => {
      banner.style.transform = "translateY(-100%)";
      banner.style.opacity = "0";
      setTimeout(() => {
        banner.style.display = "none";
        banner.style.background = "#0a66c2";
        if (spinner) spinner.style.display = "inline-block";
      }, 350);
    }, 2500);
  } else {
    banner.style.transform = "translateY(-100%)";
    banner.style.opacity = "0";
    setTimeout(() => {
      banner.style.display = "none";
    }, 350);
  }
}
