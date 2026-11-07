import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addActionItem, addTask, deleteApplication, toggleAction, toggleTask, updateApplication } from "@/app/actions";
import { getApplication, isNoResponse } from "@/lib/queries";
import { STATUSES } from "@/lib/ingest";
import { ActionBadge, STATUS_LABEL, StatusBadge, dueTone, fmtDate, relDays } from "@/components/ui";

const CATEGORY_LABEL: Record<string, string> = {
  confirmation: "Application received",
  oa: "Online assessment",
  interview: "Interview",
  rejection: "Rejection",
  offer: "Offer",
  action_required: "Action required",
  update_other: "Update",
};

type TimelineItem =
  | { kind: "status"; at: string; status: (typeof STATUSES)[number]; subject: string | null }
  | { kind: "action"; at: string; id: number; description: string; link: string | null; due: string | null; done: boolean; type: string }
  | { kind: "email"; at: string; id: number; subject: string; sender: string; category: string; snippet: string; gmailId: string };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getApplication(Number(id));
  if (!data) notFound();
  const { app, events, actions, emails, tasks, domains } = data;
  const openActions = actions.filter((a) => !a.done).length;

  const timeline: TimelineItem[] = [
    ...events.map((e) => ({ kind: "status" as const, at: e.occurred_at, status: e.status, subject: e.subject })),
    ...actions.map((a) => ({ kind: "action" as const, at: a.created_at, id: a.id, description: a.description, link: a.link, due: a.due_at, done: a.done, type: a.type })),
    ...emails.map((e) => ({ kind: "email" as const, at: e.date, id: e.id, subject: e.subject, sender: e.sender, category: e.category, snippet: e.snippet, gmailId: e.gmail_id })),
  ].sort((a, b) => b.at.localeCompare(a.at) || (a.kind === "email" ? 1 : -1));

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-900">
        ← All applications
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{app.company}</h1>
          <p className="text-stone-600">{app.role ?? "Role unknown"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={app.status} />
            <ActionBadge count={openActions} />
            {isNoResponse(app) && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">No response 21d+</span>}
          </div>
        </div>
        <div className="text-right text-sm text-stone-600">
          <div>Applied {fmtDate(app.applied_at)}</div>
          <div>Last update {fmtDate(app.last_update_at)}</div>
          {app.job_url && (
            <a href={app.job_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
              Job posting ↗
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold">Timeline</h2>
          <ol className="relative px-4 py-4">
            {timeline.length === 0 && <p className="text-sm text-stone-500">No activity yet.</p>}
            {timeline.map((t, i) => (
              <li key={`${t.kind}-${i}`} className="relative border-l border-stone-200 pb-5 pl-5 last:pb-0">
                <span
                  className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${
                    t.kind === "status" ? "bg-stone-900" : t.kind === "action" ? (t.done ? "bg-stone-300" : "bg-red-500") : "bg-stone-300"
                  }`}
                />
                <div className="text-xs text-stone-500">{fmtDate(t.at, true)}</div>
                {t.kind === "status" && (
                  <div className="mt-0.5 flex items-center gap-2 text-sm">
                    Status → <StatusBadge status={t.status} />
                  </div>
                )}
                {t.kind === "action" && (
                  <div className="mt-0.5 flex items-start gap-2">
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button
                        title={t.done ? "Mark not done" : "Mark done"}
                        className={`mt-0.5 h-4 w-4 rounded border ${t.done ? "border-stone-300 bg-stone-300" : "border-red-400"}`}
                      />
                    </form>
                    <div className={`text-sm ${t.done ? "text-stone-400 line-through" : ""}`}>
                      <span className="font-medium">Action ({t.type}):</span> {t.description}
                      {t.due && <span className={`ml-2 text-xs ${dueTone(t.due)}`}>due {fmtDate(t.due)} ({relDays(t.due)})</span>}
                      {t.link && (
                        <a href={t.link} target="_blank" rel="noreferrer" className="block truncate text-xs text-sky-700 hover:underline">
                          {t.link}
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {t.kind === "email" && (
                  <div className="mt-0.5">
                    <a
                      href={`https://mail.google.com/mail/u/0/#all/${t.gmailId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium hover:underline"
                    >
                      {t.subject || "(no subject)"}
                    </a>
                    <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{CATEGORY_LABEL[t.category] ?? t.category}</span>
                    <div className="text-xs text-stone-500">{t.sender}</div>
                    <p className="mt-1 line-clamp-2 text-sm text-stone-600">{t.snippet}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className="space-y-6">
          <section className="card">
            <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold">Details</h2>
            <form action={updateApplication} className="space-y-3 px-4 py-4">
              <input type="hidden" name="id" value={app.id} />
              <label className="block">
                <span className="label">Company</span>
                <input name="company" defaultValue={app.company} className="input mt-1 w-full" />
              </label>
              <label className="block">
                <span className="label">Role</span>
                <input name="role" defaultValue={app.role ?? ""} className="input mt-1 w-full" />
              </label>
              <label className="block">
                <span className="label">Status</span>
                <select name="status" defaultValue={app.status} className="input mt-1 w-full">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Job URL</span>
                <input name="job_url" defaultValue={app.job_url ?? ""} className="input mt-1 w-full" />
              </label>
              <label className="block">
                <span className="label">Notes</span>
                <textarea name="notes" defaultValue={app.notes ?? ""} rows={4} className="input mt-1 w-full" />
              </label>
              <button className="btn-primary w-full justify-center">Save</button>
            </form>
            {domains.length > 0 && <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Watching emails from: {domains.join(", ")}</p>}
          </section>

          <section className="card">
            <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold">Tasks</h2>
            <ul className="divide-y divide-stone-100">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                  <form action={toggleTask}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className={`h-4 w-4 rounded border ${t.done ? "border-stone-300 bg-stone-300" : "border-stone-400"}`} />
                  </form>
                  <span className={`flex-1 text-sm ${t.done ? "text-stone-400 line-through" : ""}`}>{t.title}</span>
                  <span className={`text-xs ${dueTone(t.done ? null : t.due_at)}`}>{fmtDate(t.due_at)}</span>
                </li>
              ))}
            </ul>
            <form action={addTask} className="flex gap-2 border-t border-stone-100 px-4 py-3">
              <input type="hidden" name="application_id" value={app.id} />
              <input name="title" placeholder="New task" className="input min-w-0 flex-1" required />
              <input name="due_at" type="datetime-local" className="input w-40" />
              <button className="btn">Add</button>
            </form>
          </section>

          <section className="card">
            <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold">Add action item</h2>
            <form action={addActionItem} className="space-y-2 px-4 py-3">
              <input type="hidden" name="application_id" value={app.id} />
              <input name="description" placeholder="e.g. Fill the candidate form" className="input w-full" required />
              <input name="link" placeholder="Link (optional)" className="input w-full" />
              <div className="flex gap-2">
                <input name="due_at" type="datetime-local" className="input flex-1" />
                <button className="btn">Add</button>
              </div>
            </form>
          </section>

          <form action={deleteApplication}>
            <input type="hidden" name="id" value={app.id} />
            <button className="text-xs text-red-700 hover:underline">Delete this application</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function Page({ params }: PageProps<"/applications/[id]">) {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse bg-stone-100" />}>
      <Detail params={params} />
    </Suspense>
  );
}
