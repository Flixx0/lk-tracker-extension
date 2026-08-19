export const TIMEZONE = "Europe/Paris";

export function ymdInTz(value: string | Date, tz = TIMEZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayYmd(tz = TIMEZONE): string {
  return ymdInTz(new Date(), tz);
}

export function isSameDay(iso: string | undefined, other = new Date()): boolean {
  if (!iso) return false;
  return ymdInTz(iso) === ymdInTz(other);
}

export function isOnOrBefore(iso: string | undefined, other = new Date()): boolean {
  if (!iso) return false;
  const a = ymdInTz(iso);
  const b = ymdInTz(other);
  return Boolean(a && b && a <= b);
}

export function isAfterDay(iso: string | undefined, other = new Date()): boolean {
  if (!iso) return false;
  const a = ymdInTz(iso);
  const b = ymdInTz(other);
  return Boolean(a && b && a > b);
}

export function daysBetween(fromIso: string, toIso: string | Date = new Date()): number | null {
  const from = ymdInTz(fromIso);
  const to = ymdInTz(toIso);
  if (!from || !to) return null;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(ms / 86_400_000);
}

export function addDaysIso(from: Date | string, days: number): string {
  const date = typeof from === "string" ? new Date(from) : new Date(from.getTime());
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function toDateInput(iso?: string | null): string {
  if (!iso) return "";
  return ymdInTz(iso);
}

export function dateInputToIso(value: string, previous?: string | null): string | null {
  if (!value) return null;
  if (previous && ymdInTz(previous) === value) return previous;
  return `${value}T12:00:00+02:00`;
}

export function lastNDays(n: number, tz = TIMEZONE): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(ymdInTz(d, tz));
  }
  return days;
}

export function startOfWeekYmd(from = new Date(), tz = TIMEZONE): string {
  const ymd = ymdInTz(from, tz);
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc.toISOString().slice(0, 10);
}

export function relativeLabel(iso?: string | null): string {
  if (!iso) return "";
  const n = daysBetween(iso, new Date());
  if (n === null) return "";
  if (n === 0) return "aujourd’hui";
  if (n === 1) return "hier";
  if (n === -1) return "demain";
  if (n > 1) return `il y a ${n} j`;
  return `dans ${Math.abs(n)} j`;
}
