export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome.runtime?.id === "string";
  } catch {
    return false;
  }
}

export function isContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Extension context invalidated") ||
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  );
}
