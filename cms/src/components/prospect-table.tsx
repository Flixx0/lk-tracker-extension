"use client";

import { ArrowDown, ArrowUp, Copy, ExternalLink, Mail, RotateCw } from "lucide-react";
import { formatDate, relativeLabel } from "@/lib/dates";
import { isFollowUpDue } from "@/lib/pipeline";
import type { Prospect, SortKey } from "@/lib/types";
import { Avatar } from "./avatar";
import { StatusBadge } from "./status-badge";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "name", label: "Prospect" },
  { key: "status", label: "Statut" },
  { key: "invitationSentAt", label: "Invitation" },
  { key: "connectionAcceptedAt", label: "Connecté" },
  { key: "messageSentAt", label: "1er message" },
  { key: "followUpDate", label: "Relance" },
  { key: "createdAt", label: "Créé" },
];

export function ProspectTable({
  prospects,
  sortKey,
  sortDir,
  selectedId,
  onSort,
  onSelect,
  onCopy,
  onMarkMessage,
  onMarkFollowUp,
}: {
  prospects: Prospect[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  selectedId?: string;
  onSort: (key: SortKey) => void;
  onSelect: (id: string) => void;
  onCopy: (url: string) => void;
  onMarkMessage: (prospect: Prospect) => void;
  onMarkFollowUp: (prospect: Prospect) => void;
}) {
  return (
    <div className="overflow-auto rounded-2xl border border-line bg-panel">
      <table className="min-w-[980px] w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-[#f7f3eb] text-left text-xs tracking-wide text-muted uppercase">
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} className="border-b border-line px-3 py-2.5 font-medium">
                <button
                  type="button"
                  onClick={() => onSort(col.key)}
                  className="inline-flex items-center gap-1 hover:text-ink"
                >
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )
                  ) : null}
                </button>
              </th>
            ))}
            <th className="border-b border-line px-3 py-2.5 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => {
            const due = isFollowUpDue(p);
            return (
              <tr
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={`cursor-pointer border-b border-line/70 hover:bg-teal-50/40 ${selectedId === p.id ? "bg-teal-50" : ""} ${due ? "bg-rose-50/40" : ""}`}
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={p.name} src={p.profilePicture} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted">{p.jobTitle || "—"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <DateCell iso={p.invitationSentAt} />
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <DateCell iso={p.connectionAcceptedAt} />
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <DateCell iso={p.messageSentAt} />
                </td>
                <td className="px-3 py-2.5">
                  <DateCell iso={p.followUpDate} warn={due} />
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <DateCell iso={p.createdAt} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <IconBtn label="Ouvrir LinkedIn" onClick={() => window.open(p.profileUrl, "_blank")}>
                      <ExternalLink className="size-3.5" />
                    </IconBtn>
                    <IconBtn label="Copier le lien" onClick={() => onCopy(p.profileUrl)}>
                      <Copy className="size-3.5" />
                    </IconBtn>
                    {!p.messageSentAt ? (
                      <IconBtn label="Marquer 1er message" onClick={() => onMarkMessage(p)}>
                        <Mail className="size-3.5" />
                      </IconBtn>
                    ) : null}
                    {due ? (
                      <IconBtn label="Marquer relancé" onClick={() => onMarkFollowUp(p)}>
                        <RotateCw className="size-3.5" />
                      </IconBtn>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {prospects.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted">Aucun prospect dans cet onglet.</p>
      ) : null}
    </div>
  );
}

function DateCell({ iso, warn }: { iso?: string; warn?: boolean }) {
  if (!iso) return <span>—</span>;
  return (
    <div className={warn ? "font-medium text-rose-800" : ""}>
      <div>{formatDate(iso)}</div>
      <div className="text-[11px] opacity-70">{relativeLabel(iso)}</div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-lg p-1.5 text-muted hover:bg-stone-100 hover:text-ink"
    >
      {children}
    </button>
  );
}
