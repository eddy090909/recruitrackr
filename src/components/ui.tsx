import type { Status } from "@/lib/ingest";

export const STATUS_LABEL: Record<Status, string> = {
  saved: "Saved",
  applied: "Applied",
  oa: "OA",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

const STATUS_STYLE: Record<Status, string> = {
  saved: "bg-stone-100 text-stone-700",
  applied: "bg-sky-50 text-sky-800 ring-sky-200",
  oa: "bg-violet-50 text-violet-800 ring-violet-200",
  interview: "bg-amber-50 text-amber-800 ring-amber-200",
  offer: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rejected: "bg-stone-100 text-stone-500 ring-stone-200",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ActionBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200">
      ⚠ Action needed{count > 1 ? ` (${count})` : ""}
    </span>
  );
}

export function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  // Deadlines stored as "end of day" don't need a clock time.
  if (d.getHours() === 23 && d.getMinutes() === 59) withTime = false;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function relDays(iso: string | null | undefined) {
  if (!iso) return "—";
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
}

export function dueTone(iso: string | null | undefined) {
  if (!iso) return "text-stone-500";
  const days = (Date.parse(iso) - Date.now()) / 86_400_000;
  if (days < 0) return "text-red-700 font-semibold";
  if (days < 2) return "text-amber-700 font-semibold";
  return "text-stone-700";
}
