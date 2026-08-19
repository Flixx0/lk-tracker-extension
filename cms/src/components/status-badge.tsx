"use client";

import {
  STATUS_LABELS,
  STATUS_ORDER,
  type FirstMessageType,
  type ProspectStatus,
} from "@/lib/types";
import { useState } from "react";

const STYLES: Record<ProspectStatus, string> = {
  invitation_envoyee: "bg-amber-100 text-amber-900 border-amber-200",
  connecte: "bg-sky-100 text-sky-900 border-sky-200",
  message_envoye: "bg-teal-100 text-teal-900 border-teal-200",
  // Legacy + 1ère relance
  relance_a_faire: "bg-rose-100 text-rose-900 border-rose-200",
  "1ere_relance": "bg-rose-100 text-rose-900 border-rose-200",
  // 2ème relance (un peu plus foncée)
  "2eme_relance": "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200",
  pas_interesse: "bg-stone-100 text-stone-900 border-stone-200",
};

export function StatusBadge({ status }: { status: ProspectStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap ${STYLES[status] ?? "bg-stone-100 text-stone-700"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function StatusSelect({
  status,
  onChange,
}: {
  status: ProspectStatus;
  onChange: (next: ProspectStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const options: ProspectStatus[] = STATUS_ORDER.includes(status)
    ? STATUS_ORDER
    : [...STATUS_ORDER, status];

  return (
    <select
      value={status}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await onChange(e.target.value as ProspectStatus);
        } finally {
          setBusy(false);
        }
      }}
      className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap outline-none transition disabled:opacity-60 disabled:cursor-wait ${STYLES[status] ?? "bg-stone-100 text-stone-700 border-stone-200"}`}
    >
      {options.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export function MessageTypeBadge({ type }: { type?: FirstMessageType }) {
  if (!type) return null;
  const isVideo = type === "video";
  return (
    <span
      title={isVideo ? "Premier message : vidéo" : "Premier message : texte"}
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        isVideo ? "bg-violet-100 text-violet-900" : "bg-sky-100 text-sky-900"
      }`}
    >
      {isVideo ? "Vidéo" : "Texte"}
    </span>
  );
}
