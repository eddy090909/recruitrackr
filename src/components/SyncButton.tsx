"use client";

import { useActionState } from "react";
import { syncNow } from "@/app/actions";

export function SyncButton() {
  const [state, action, pending] = useActionState(syncNow, null);
  return (
    <form action={action} className="flex items-center gap-3">
      {state && (
        <span className={`max-w-md truncate text-xs ${state.ok ? "text-neutral-600" : "text-red-700"}`} title={state.message}>
          {state.message}
        </span>
      )}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Syncing…" : "↻ Sync now"}
      </button>
    </form>
  );
}
