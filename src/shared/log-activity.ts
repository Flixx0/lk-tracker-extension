import { notifyActivity } from "./notify";
import { showToast } from "./toast";

/**
 * Affiche un toast LinkedIn + notification système (sauf si quiet).
 * quiet = true pour les messages de progression (« Envoi… », « Prêt… »).
 */
export async function logActivity(
  message: string,
  title = "LK Tracker",
  isError = false,
  quiet = false
): Promise<void> {
  showToast(`${title}: ${message}`, isError);
  if (!quiet) {
    await notifyActivity(message, title);
  }
}
