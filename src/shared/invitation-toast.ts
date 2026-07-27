/** Toast LinkedIn après envoi d’invitation : « Invitation envoyée à Justine » */
export function isInvitationSentToastText(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length > 200) return false;
  return (
    /invitation envoyée à/i.test(t) ||
    /invitation sent to/i.test(t) ||
    /^invitation envoyée[.!]?$/i.test(t) ||
    /^invitation sent[.!]?$/i.test(t)
  );
}

export function parseNameFromInvitationToast(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  const fr = t.match(/invitation envoyée à\s+(.+?)[.!]?\s*$/i);
  if (fr?.[1]) return fr[1].trim();
  const en = t.match(/invitation sent to\s+(.+?)[.!]?\s*$/i);
  if (en?.[1]) return en[1].trim();
  return null;
}

const TOAST_SELECTORS =
  ".artdeco-toast-item, [data-test-artdeco-toast-item], .artdeco-toast-item__message, [role='alert']";

type TopWindow = Window & {
  __lkToastWatcher?: boolean;
  __lkProcessedInvitationToasts?: Set<string>;
};

function getTopWin(): TopWindow {
  return window.top as TopWindow;
}

/** Empêche le même toast d’être traité plusieurs fois (multi-iframe / scan répété) */
export function markInvitationToastIfNew(text: string): boolean {
  const top = getTopWin();
  if (!top.__lkProcessedInvitationToasts) {
    top.__lkProcessedInvitationToasts = new Set();
  }
  const key = text.trim().slice(0, 120);
  if (top.__lkProcessedInvitationToasts.has(key)) return false;
  top.__lkProcessedInvitationToasts.add(key);
  return true;
}

function extractToastText(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ");
}

export function findInvitationToastText(root: ParentNode): string | null {
  if (root instanceof HTMLElement) {
    const text = extractToastText(root);
    if (isInvitationSentToastText(text)) return text;
  }

  for (const el of Array.from(root.querySelectorAll<HTMLElement>(TOAST_SELECTORS))) {
    const text = extractToastText(el);
    if (isInvitationSentToastText(text)) return text;
  }

  return null;
}

export function installInvitationToastWatcher(onMatch: (text: string) => void): void {
  if (window !== window.top) return;

  const top = getTopWin();
  if (top.__lkToastWatcher) return;
  top.__lkToastWatcher = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        const text = findInvitationToastText(node);
        if (text && markInvitationToastIfNew(text)) onMatch(text);
      }
    }
  });

  const start = (): void => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
