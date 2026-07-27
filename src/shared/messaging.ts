import type { ExtensionMessage } from "./types";
import { isContextInvalidatedError, isExtensionContextValid } from "./extension-context";

export function sendToBackground<T>(message: ExtensionMessage): Promise<T | null> {
  if (!isExtensionContextValid()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve(null);
          return;
        }
        if (response && typeof response === "object" && "error" in response) {
          resolve(null);
          return;
        }
        resolve(response as T);
      });
    } catch {
      resolve(null);
    }
  });
}

export function safeSendToBackground<T>(
  message: ExtensionMessage,
  onInvalid?: () => void
): Promise<T | null> {
  if (!isExtensionContextValid()) {
    onInvalid?.();
    return Promise.resolve(null);
  }

  return sendToBackground<T>(message).then((result) => {
    if (result === null && !isExtensionContextValid()) onInvalid?.();
    return result;
  });
}

export function isMessagingFailure(error: unknown): boolean {
  return isContextInvalidatedError(error);
}
