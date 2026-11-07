import Link from "next/link";
import { Suspense } from "react";
import { addApplication, toggleAction, toggleTask } from "./actions";
import { getStats, isNoResponse, listApplications, listDueSoon, listOpenActions, daysSince } from "@/lib/queries";
import { STATUSES } from "@/lib/ingest";
import { ActionBadge, STATUS_LABEL, dueTone, fmtDate, relDays } from "@/components/ui";
import { StatusSelect } from "@/components/StatusSelect";

// Server actions on this page (Sync now) may run for a while on serverless hosts.
export const maxDuration = 300;

const FILTERS: { key: string; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "action", label: "Action needed" },
  { key: "applied", label: "Applied" },
  { key: "oa", label: "OA" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "Rejected" },
  { key: "no_response", label: "No response" },
];

async function Banner({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (sp.connected) return <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Gmail connected. Hit <b>Sync now</b> to pull your recruiting emails.</div>;
  return null;
}

async function Stats() {
  const s = await getStats();
  const items = [
    { label: "Applications", value: s.total },
    { label: "In progress", value: (s.by.oa ?? 0) + (s.by.interview ?? 0) },
    { label: "Offers", value: s.by.offer ?? 0 },
    { label: "Response rate", value: `${Math.round(s.responseRate * 100)}%` },
    { label: "No response 21d+", value: s.noResponse },
  ];
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className="card px-4 py-3">
          <div className="label">{i.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{i.value}</div>
        </div>
      ))}
    </div>
  );
}

async function ActionNeeded() {
  const items = await listOpenActions();
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-200 bg-red-50/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-red-900">⚠ Action needed</h2>
        <span className="text-xs text-red-800">{items.length} open</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-stone-500">Nothing waiting on you.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3">
              <form action={toggleAction}>
                <input type="hidden" name="id" value={a.id} />
                <button title="Mark done" className="mt-0.5 h-4 w-4 rounded border border-stone-400 hover:bg-stone-100" />
              </form>
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <Link href={`/applications/${a.application_id}`} className="font-semibold hover:underline">
                    {a.company}
                  </Link>
                  <span className="text-stone-400"> · {a.type}</span>
                </div>
                <div className="text-sm text-stone-700">{a.description}</div>
                {a.link && (
                  <a href={a.link} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-sky-700 hover:underline">
                    {a.link}
                  </a>
                )}
              </div>
              <div className={`shrink-0 text-right text-xs ${dueTone(a.due_at)}`}>
                {a.due_at ? (
                  <>
                    {fmtDate(a.due_at)}
                    <div>{relDays(a.due_at)}</div>
                  </>
                ) : (
                  <span className="text-stone-400">no deadline</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function DueSoon() {
  const tasks = await listDueSoon(7);
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h2 className="text-sm font-semibold">Due in the next 7 days</h2>
        <span className="text-xs text-stone-500">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="px-4 py-6 text-sm text-stone-500">No deadlines this week.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <form action={toggleTask}>
                <input type="hidden" name="id" value={t.id} />
                <button title="Mark done" className="h-4 w-4 rounded border border-stone-400 hover:bg-stone-100" />
              </form>
              <div className="min-w-0 flex-1 truncate text-sm">
                {t.application_id ? (
                  <Link href={`/applications/${t.application_id}`} className="hover:underline">
                    {t.title}
                  </Link>
                ) : (
                  t.title
                )}
              </div>
              <div className={`shrink-0 text-xs ${dueTone(t.due_at)}`}>
                {fmtDate(t.due_at, true)} · {relDays(t.due_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function ApplicationsTable({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? "active";
  const apps = await listApplications({ status, q: sp.q });
  const href = (s: string) => `/?status=${s}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`;
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href(f.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${status === f.key ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input name="q" defaultValue={sp.q} placeholder="Search company or role" className="input w-56" />
        </form>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Applied</th>
              <th className="px-4 py-2 font-medium">Last update</th>
              <th className="px-4 py-2 font-medium">Next due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {apps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-stone-500">
                  No applications here yet. Connect Gmail and sync, or add one below.
                </td>
              </tr>
            )}
            {apps.map((a) => {
              const stale = isNoResponse(a);
              const d = daysSince(a.last_update_at);
              return (
                <tr key={a.id} className="hover:bg-stone-50/70">
                  <td className="px-4 py-2.5">
                    <Link href={`/applications/${a.id}`} className="font-semibold hover:underline">
                      {a.company}
                    </Link>
                    <div className="mt-0.5">
                      <ActionBadge count={a.open_actions} />
                    </div>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-stone-700" title={a.role ?? ""}>
                    {a.role ?? <span className="text-stone-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusSelect key={a.status} id={a.id} status={a.status} />
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">{fmtDate(a.applied_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-stone-600">{d === null ? "—" : d === 0 ? "today" : `${d}d ago`}</span>
                    {stale && <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">No response</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-xs ${dueTone(a.next_due)}`}>{a.next_due ? `${fmtDate(a.next_due)} (${relDays(a.next_due)})` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form action={addApplication} className="flex flex-wrap items-end gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
        <span className="label mr-2 self-center">Add manually</span>
        <input name="company" required placeholder="Company" className="input w-40" />
        <input name="role" placeholder="Role" className="input w-64" />
        <input name="job_url" placeholder="Job URL" className="input w-56" />
        <select name="status" defaultValue="applied" className="input">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button className="btn">Add</button>
      </form>
    </section>
  );
}

const Skeleton = ({ h = "h-40" }: { h?: string }) => <div className={`card ${h} animate-pulse bg-stone-100`} />;

export default function Home({ searchParams }: PageProps<"/">) {
  const sp = searchParams as Promise<Record<string, string | undefined>>;
  return (
    <>
      <Suspense>
        <Banner searchParams={sp} />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-20 mb-8" />}>
        <Stats />
      </Suspense>
      <div className="mb-8 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Suspense fallback={<Skeleton />}>
            <ActionNeeded />
          </Suspense>
        </div>
        <div className="lg:col-span-2">
          <Suspense fallback={<Skeleton />}>
            <DueSoon />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={<Skeleton h="h-96" />}>
        <ApplicationsTable searchParams={sp} />
      </Suspense>
    </>
  );
}
