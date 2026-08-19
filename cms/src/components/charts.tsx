export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)} %`;
}

export function nDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1).replace(/\.0$/, "")} j`;
}

export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function BarList({
  items,
  color = "bg-accent",
}: {
  items: { label: string; count: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="flex flex-col gap-2.5">
      {items.length === 0 ? <p className="text-sm text-muted">Aucune donnée</p> : null}
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3">
          <div>
            <div className="mb-1 flex justify-between gap-2 text-sm">
              <span className="truncate">{item.label}</span>
              <span className="text-muted tabular-nums">{item.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${(item.count / max) * 100}%` }} />
            </div>
          </div>
          <span className="text-right text-xs text-muted tabular-nums">
            {Math.round((item.count / max) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function Funnel({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      {items.map((item, i) => {
        const width = 40 + (item.value / max) * 60;
        return (
          <div key={item.label} className="flex w-full flex-col items-center gap-1">
            <div
              className="flex h-10 items-center justify-between rounded-xl bg-teal-800 px-4 text-sm text-white"
              style={{ width: `${width}%`, minWidth: "40%" }}
            >
              <span>{item.label}</span>
              <span className="font-semibold tabular-nums">{item.value}</span>
            </div>
            {i < items.length - 1 ? <div className="h-2 w-px bg-line" /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ActivityChart({
  days,
}: {
  days: { day: string; created: number; invited: number; connected: number; messaged: number }[];
}) {
  const max = Math.max(1, ...days.map((d) => d.created + d.invited + d.connected + d.messaged));
  return (
    <div>
      <div className="flex h-36 items-end gap-1">
        {days.map((d) => {
          const total = d.created + d.invited + d.connected + d.messaged;
          const h = Math.max(total ? 6 : 2, (total / max) * 100);
          return (
            <div
              key={d.day}
              title={`${d.day} — créés ${d.created}, invités ${d.invited}, connectés ${d.connected}, messages ${d.messaged}`}
              className="group relative flex-1"
            >
              <div
                className="w-full rounded-t bg-teal-700/80 transition group-hover:bg-teal-600"
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted">
        <span>{days[0]?.day.slice(5)}</span>
        <span>30 jours</span>
        <span>{days.at(-1)?.day.slice(5)}</span>
      </div>
    </div>
  );
}
