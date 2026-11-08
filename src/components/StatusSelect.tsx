"use client";

import { quickStatus } from "@/app/actions";
import { STATUS_LABEL } from "./ui";
import type { Status } from "@/lib/ingest";

const OPTIONS: Status[] = ["saved", "applied", "oa", "interview", "offer", "rejected"];

const STYLE: Record<Status, string> = {
  saved: "bg-neutral-100 text-neutral-500",
  applied: "bg-neutral-100 text-neutral-700",
  oa: "bg-black text-white",
  interview: "bg-black text-white",
  offer: "bg-emerald-600 text-white",
  rejected: "bg-white text-neutral-400 ring-1 ring-inset ring-neutral-200",
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
        className={`cursor-pointer appearance-none rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider outline-none ${STYLE[status]}`}
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
