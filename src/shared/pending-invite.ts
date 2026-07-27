import type { ExtensionMessage, PendingInvite } from "./types";
import { safeSendToBackground } from "./messaging";

export async function savePendingInvite(invite: PendingInvite): Promise<void> {
  await safeSendToBackground({
    type: "SAVE_PENDING_INVITE",
    payload: invite,
  });
}

export async function getPendingInvite(): Promise<PendingInvite | null> {
  return await safeSendToBackground<PendingInvite | null>({ type: "GET_PENDING_INVITE" });
}

export async function clearPendingInvite(): Promise<void> {
  await safeSendToBackground({ type: "CLEAR_PENDING_INVITE" });
}
