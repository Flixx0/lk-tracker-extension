"use client";

import { ExternalLink, X } from "lucide-react";
import { dateInputToIso, formatDateTime, relativeLabel, toDateInput } from "@/lib/dates";
import { STATUS_LABELS, STATUS_ORDER, type FirstMessageType, type Prospect, type ProspectPatch, type ProspectStatus } from "@/lib/types";
import { Avatar } from "./avatar";
import { MessageTypeBadge, StatusBadge } from "./status-badge";

export function ProspectDrawer({
  prospect,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  prospect: Prospect;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: ProspectPatch) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  async function saveDates(form: HTMLFormElement) {
    const data = new FormData(form);
    const status = String(data.get("status")) as ProspectStatus;
    const jobTitle = String(data.get("jobTitle") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim();
    const rawType = String(data.get("firstMessageType") ?? "");
    const firstMessageType: FirstMessageType | null =
      rawType === "video" || rawType === "text" ? rawType : null;
    const replied = data.get("replied") !== null;
    await onSave({
      status,
      jobTitle: jobTitle || null,
      notes: notes || null,
      firstMessageType,
      replied,
      invitationSentAt: dateInputToIso(String(data.get("invitationSentAt") ?? ""), prospect.invitationSentAt),
      connectionAcceptedAt: dateInputToIso(
        String(data.get("connectionAcceptedAt") ?? ""),
        prospect.connectionAcceptedAt
      ),
      messageSentAt: dateInputToIso(String(data.get("messageSentAt") ?? ""), prospect.messageSentAt),
      followUpDate: dateInputToIso(String(data.get("followUpDate") ?? ""), prospect.followUpDate),
      followUpSentAt: dateInputToIso(String(data.get("followUpSentAt") ?? ""), prospect.followUpSentAt),
    });
  }

  return (
    <aside className="flex h-full min-h-0 w-full max-w-md flex-col overflow-hidden border-l border-line bg-panel">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line p-5">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={prospect.name} src={prospect.profilePicture} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{prospect.name}</h2>
            <p className="truncate text-sm text-muted">{prospect.jobTitle || "Poste inconnu"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={prospect.status} />
              <MessageTypeBadge type={prospect.firstMessageType} />
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted hover:bg-stone-100 hover:text-ink"
          aria-label="Fermer"
        >
          <X className="size-4" />
        </button>
      </div>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveDates(e.currentTarget);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <a
            href={prospect.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            Ouvrir le profil LinkedIn
            <ExternalLink className="size-3.5" />
          </a>

          <label className="text-sm font-medium">
            Poste
            <input
              name="jobTitle"
              defaultValue={prospect.jobTitle ?? ""}
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-accent/20 focus:ring-4"
            />
          </label>

          <label className="text-sm font-medium">
            Statut
            <select
              name="status"
              defaultValue={prospect.status}
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-accent/20 focus:ring-4"
            >
              {[...STATUS_ORDER, ...(STATUS_ORDER.includes(prospect.status) ? [] : [prospect.status])].map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium">
            Notes
            <textarea
              name="notes"
              defaultValue={prospect.notes ?? ""}
              rows={5}
              placeholder="Contexte, relance, réponse, prochaine action…"
              className="mt-1 min-h-28 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm leading-relaxed outline-none ring-accent/20 focus:ring-4"
            />
          </label>

          <DateField name="invitationSentAt" label="Invitation envoyée" value={prospect.invitationSentAt} />
          <DateField name="connectionAcceptedAt" label="Connexion acceptée" value={prospect.connectionAcceptedAt} />
          <DateField name="messageSentAt" label="Premier message" value={prospect.messageSentAt} />
          <label className="text-sm font-medium">
            Type du 1er message
            <select
              name="firstMessageType"
              defaultValue={prospect.firstMessageType ?? ""}
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-accent/20 focus:ring-4"
            >
              <option value="">Non détecté</option>
              <option value="video">Vidéo</option>
              <option value="text">Texte</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="replied"
              defaultChecked={prospect.replied ?? false}
              className="h-4 w-4 rounded border-line text-accent focus:ring-accent/20"
            />
            A répondu
          </label>
          <DateField name="followUpDate" label="Date de relance" value={prospect.followUpDate} />
          <DateField name="followUpSentAt" label="Relance envoyée" value={prospect.followUpSentAt} />

          <p className="text-xs text-muted">
            Créé {formatDateTime(prospect.createdAt)} · Maj {formatDateTime(prospect.updatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-line bg-panel p-4">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            Enregistrer
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`Supprimer ${prospect.name} ?`)) return;
              await onDelete();
            }}
            className="rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
          >
            Supprimer
          </button>
        </div>
      </form>
    </aside>
  );
}

function DateField({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <label className="text-sm font-medium">
      <span className="flex items-baseline justify-between gap-2">
        {label}
        <span className="text-xs font-normal text-muted">{relativeLabel(value)}</span>
      </span>
      <input
        type="date"
        name={name}
        defaultValue={toDateInput(value)}
        className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-accent/20 focus:ring-4"
      />
    </label>
  );
}
