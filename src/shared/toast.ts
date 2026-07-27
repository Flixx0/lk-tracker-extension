export function showToast(message: string, isError = false): void {
  let toast = document.getElementById("lk-tracker-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "lk-tracker-toast";
    toast.style.cssText =
      "position:fixed;bottom:24px;right:24px;z-index:99999;max-width:340px;padding:12px 16px;border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.4;color:#fff;background:#0a66c2;box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:1;transition:opacity .3s";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background = isError ? "#c41e3a" : "#0a66c2";
  toast.style.opacity = "1";

  const prev = (toast as HTMLElement & { _lkTimeout?: ReturnType<typeof setTimeout> })._lkTimeout;
  if (prev) clearTimeout(prev);

  (toast as HTMLElement & { _lkTimeout?: ReturnType<typeof setTimeout> })._lkTimeout = setTimeout(
    () => {
      toast!.style.opacity = "0";
    },
    5000
  );
}
