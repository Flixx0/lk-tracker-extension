import * as XLSX from "xlsx";
import type { Prospect } from "./types";
import { STATUS_LABELS } from "./types";

function prospectToRow(prospect: Prospect): Record<string, string> {
  return {
    Nom: prospect.name,
    "Lien profil": prospect.profileUrl,
    Poste: prospect.jobTitle ?? "",
    Statut: STATUS_LABELS[prospect.status] ?? prospect.status,
    "Invitation envoyée": prospect.invitationSentAt ?? "",
    "Connexion acceptée": prospect.connectionAcceptedAt ?? "",
    "Message envoyé": prospect.messageSentAt ?? "",
    "Date relance": prospect.followUpDate ?? "",
    "Créé le": prospect.createdAt,
    "Mis à jour le": prospect.updatedAt,
  };
}

export function buildExcelBlob(prospects: Prospect[]): Blob {
  const rows = prospects.map(prospectToRow);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Prospects");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function downloadExcel(prospects: Prospect[]): Promise<void> {
  const blob = buildExcelBlob(prospects);
  const dataUrl = await blobToDataUrl(blob);
  const filename = `lk-tracker-prospects-${new Date().toISOString().slice(0, 10)}.xlsx`;

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
  });
}
