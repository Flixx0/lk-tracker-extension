import { isExtensionContextValid } from "./extension-context";
import type { ExtensionMessage } from "./types";

export async function notifyActivity(message: string, title = "LK Tracker"): Promise<void> {
  if (!isExtensionContextValid()) return;
  try {
    await chrome.runtime.sendMessage({
      type: "SHOW_NOTIFICATION",
      payload: { title, message },
    } satisfies ExtensionMessage);
  } catch {
    // Extension rechargée ou contexte invalide
  }
}
