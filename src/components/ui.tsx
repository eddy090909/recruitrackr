import type { Status } from "@/lib/ingest";

export const STATUS_LABEL: Record<Status, string> = {
  saved: "Saved",
  applied: "Applied",
  oa: "OA",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

/** Monochrome status pills: black = in progress, green = offer, outline = closed. */
export const STATUS_STYLE: Record<Status, string> = {
  saved: "bg-neutral-100 text-neutral-500",
  applied: "bg-neutral-100 text-neutral-700",
  oa: "bg-black text-white",
  interview: "bg-black text-white",
  offer: "bg-emerald-600 text-white",
  rejected: "bg-white text-neutral-400 ring-1 ring-inset ring-neutral-200",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Red = something is waiting on you. */
export function ActionBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
      <span className="h-1.5 w-1.5 rounded-full bg-white" />
      Action needed{count > 1 ? ` · ${count}` : ""}
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
  if (!iso) return "text-neutral-400";
  const days = (Date.parse(iso) - Date.now()) / 86_400_000;
  if (days < 2) return "text-red-600 font-semibold";
  return "text-neutral-600";
}
