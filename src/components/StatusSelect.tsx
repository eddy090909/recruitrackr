"use client";

import { quickStatus } from "@/app/actions";
import { STATUS_LABEL } from "./ui";
import type { Status } from "@/lib/ingest";

const OPTIONS: Status[] = ["saved", "applied", "oa", "interview", "offer", "rejected"];

const STYLE: Record<Status, string> = {
  saved: "bg-stone-100 text-stone-700 ring-stone-200",
  applied: "bg-sky-50 text-sky-800 ring-sky-200",
  oa: "bg-violet-50 text-violet-800 ring-violet-200",
  interview: "bg-amber-50 text-amber-800 ring-amber-200",
  offer: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rejected: "bg-stone-100 text-stone-500 ring-stone-200",
};

/** Status pill that doubles as a dropdown; saves on change. */
export function StatusSelect({ id, status }: { id: number; status: Status }) {
  return (
    <form action={quickStatus}>
      <input type="hidden" name="id" value={id} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Status"
        className={`cursor-pointer appearance-none rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset outline-none ${STYLE[status]}`}
      >
        {OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </form>
  );
}
