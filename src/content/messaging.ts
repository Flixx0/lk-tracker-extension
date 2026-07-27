import { isExtensionContextValid } from "../shared/extension-context";
import { logActivity } from "../shared/log-activity";
import { sendToBackground } from "../shared/messaging";
import type { ExtensionMessage } from "../shared/types";

async function isTrackingEnabled(): Promise<boolean> {
  const settings = await sendToBackground<{ trackingEnabled: boolean }>({
    type: "GET_SETTINGS",
  });
  return settings?.trackingEnabled ?? false;
}

function extractProfileUrlFromMessaging(): string | null {
  const link = document.querySelector<HTMLAnchorElement>(
    "a[href*='/in/'][data-control-name], .msg-overlay-bubble-header a[href*='/in/'], .msg-thread a[href*='/in/']"
  );
  if (link?.href) return link.href.split("?")[0];

  const pathMatch = window.location.pathname.match(/\/messaging\/thread\/([^/]+)/);
  if (pathMatch) {
    const profileLink = document.querySelector<HTMLAnchorElement>("a[href*='/in/']");
    if (profileLink?.href) return profileLink.href.split("?")[0];
  }

  return null;
}

function attachMessageListeners(): void {
  if (!isExtensionContextValid()) return;

  const sendButtons = document.querySelectorAll<HTMLElement>(
    "button[type='submit'], button.msg-form__send-button, button[aria-label*='Send'], button[aria-label*='Envoyer']"
  );

  for (const button of Array.from(sendButtons)) {
    if (button.dataset.lkTrackerBound) continue;
    button.dataset.lkTrackerBound = "true";

    button.addEventListener("click", () => {
      void (async () => {
        if (!(await isTrackingEnabled())) return;

        const profileUrl = extractProfileUrlFromMessaging();
        if (!profileUrl) return;

        setTimeout(async () => {
          const settings = await sendToBackground<{ followUpDays: number }>({
            type: "GET_SETTINGS",
          });
          if (!settings) return;

          const now = new Date();
          const followUp = new Date(now);
          followUp.setDate(followUp.getDate() + settings.followUpDays);

          await sendToBackground({
            type: "UPDATE_PROSPECT",
            payload: {
              profileUrl,
              patch: {
                status: "message_envoye",
                messageSentAt: now.toISOString(),
                followUpDate: followUp.toISOString(),
              },
            },
          });
          await logActivity(
            `Message enregistré — relance le ${followUp.toLocaleDateString("fr-FR")}`,
            "LK Tracker"
          );
          console.log("[LK Tracker] Message enregistré pour", profileUrl);
        }, 300);
      })();
    });
  }
}

function initMessagingHandlers(): void {
  attachMessageListeners();
  const observer = new MutationObserver(() => attachMessageListeners());
  observer.observe(document.body, { childList: true, subtree: true });
}

export function initMessaging(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMessagingHandlers);
  } else {
    initMessagingHandlers();
  }
  console.log("[LK Tracker] Module messaging actif");
}
