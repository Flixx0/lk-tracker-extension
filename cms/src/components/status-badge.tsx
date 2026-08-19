import { STATUS_LABELS, type ProspectStatus } from "@/lib/types";

const STYLES: Record<ProspectStatus, string> = {
  invitation_envoyee: "bg-amber-100 text-amber-900",
  connecte: "bg-sky-100 text-sky-900",
  message_envoye: "bg-teal-100 text-teal-900",
  relance_a_faire: "bg-rose-100 text-rose-900",
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
