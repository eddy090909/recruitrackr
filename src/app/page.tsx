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
  if (sp.connected) return <div className="mb-6 rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-700">Gmail connected. Hit <b>Sync now</b> to pull your recruiting emails.</div>;
  return null;
}

function linkLabel(type: string) {
  return { form: "Open form", assessment: "Start assessment", schedule: "Pick a time", documents: "Upload documents", reply: "Open email" }[type] ?? "Open link";
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
    <div className="card mb-6 grid grid-cols-2 gap-y-4 px-6 py-5 md:grid-cols-5">
      {items.map((i) => (
        <div key={i.label}>
          <div className="label">{i.label}</div>
          <div className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight">{i.value}</div>
        </div>
      ))}
    </div>
  );
}

async function ActionNeeded() {
  const items = await listOpenActions();
  return (
    <section className="card px-5 py-5">
      <div className="mb-4 flex items-center justify-between px-1">
        <h2 className="label-urgent flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-600" />
          Action needed
        </h2>
        {items.length > 0 && (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white tabular-nums">{items.length}</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="card-inner px-4 py-6 text-sm text-neutral-500">Nothing waiting on you.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="card-inner border-l-4 border-red-600 px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/applications/${a.application_id}`} className="text-base font-semibold hover:underline">
                    {a.company}
                  </Link>
                  <div className="text-xs text-neutral-500">{a.role ?? a.type}</div>
                </div>
                <div className={`shrink-0 text-right text-xs ${dueTone(a.due_at)}`}>
                  {a.due_at ? `Due ${fmtDate(a.due_at)} · ${relDays(a.due_at)}` : <span className="text-neutral-400">No deadline</span>}
                </div>
              </div>
              <p className="mt-2 text-sm text-neutral-700">{a.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {a.link && (
                  <a href={a.link} target="_blank" rel="noreferrer" className="btn-primary px-4 py-1.5 text-xs">
                    {linkLabel(a.type)} ↗
                  </a>
                )}
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="chip py-1.5" aria-label={`Mark "${a.description}" done for ${a.company}`}>
                    Mark done
                  </button>
                </form>
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
    <section className="card px-5 py-5">
      <div className="mb-4 flex items-center justify-between px-1">
        <h2 className="label">Also due this week</h2>
        <span className="text-xs text-neutral-500 tabular-nums">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="card-inner px-4 py-6 text-sm text-neutral-500">No other deadlines this week.</p>
      ) : (
        <ul className="card-inner divide-y divide-neutral-100">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <form action={toggleTask}>
                <input type="hidden" name="id" value={t.id} />
                <button title="Mark done" aria-label={`Mark "${t.title}" done`} className="h-4 w-4 rounded-full ring-1 ring-neutral-300 hover:bg-neutral-100" />
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
              <div className={`shrink-0 text-xs ${dueTone(t.due_at)}`}>{relDays(t.due_at)}</div>
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
    <section className="card px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <h2 className="label">Applications</h2>
        <form className="flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input name="q" defaultValue={sp.q} placeholder="Search company or role" className="input w-60 bg-white" />
        </form>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5 px-1">
        {FILTERS.map((f) => (
          <Link key={f.key} href={href(f.key)} className={status === f.key ? "chip-active" : f.key === "action" ? "inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100" : "chip bg-white ring-1 ring-neutral-200"}>
            {f.label}
          </Link>
        ))}
      </div>
      <div className="card-inner overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-neutral-100">
              {["Company", "Role", "Status", "Applied", "Last update", "Next due"].map((h) => (
                <th key={h} className="label px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {apps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-neutral-500">
                  No applications here yet. Sync your Gmail or add one below.
                </td>
              </tr>
            )}
            {apps.map((a) => {
              const stale = isNoResponse(a);
              const d = daysSince(a.last_update_at);
              return (
                <tr key={a.id} className={`hover:bg-neutral-50 ${a.open_actions ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-3.5">
                    <Link href={`/applications/${a.id}`} className="font-semibold hover:underline">
                      {a.company}
                    </Link>
                    {a.open_actions > 0 && (
                      <div className="mt-1">
                        <ActionBadge count={a.open_actions} />
                      </div>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3.5 text-neutral-600" title={a.role ?? ""}>
                    {a.role ?? <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusSelect key={a.status} id={a.id} status={a.status} />
                  </td>
                  <td className="px-4 py-3.5 text-neutral-600">{fmtDate(a.applied_at)}</td>
                  <td className="px-4 py-3.5">
                    <span className="text-neutral-600">{d === null ? "—" : d === 0 ? "today" : `${d}d ago`}</span>
                    {stale && <span className="chip-outline ml-2 px-2 py-0.5 text-[10px] uppercase tracking-wider">No response</span>}
                  </td>
                  <td className={`px-4 py-3.5 text-xs ${dueTone(a.next_due)}`}>{a.next_due ? `${fmtDate(a.next_due)} · ${relDays(a.next_due)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form action={addApplication} className="mt-4 flex flex-wrap items-center gap-2 px-1">
        <span className="label mr-2">Add manually</span>
        <input name="company" required placeholder="Company" className="input w-40 bg-white" />
        <input name="role" placeholder="Role" className="input w-60 bg-white" />
        <input name="job_url" placeholder="Job URL" className="input w-52 bg-white" />
        <select name="status" defaultValue="applied" className="input bg-white">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button className="btn-primary">Add →</button>
      </form>
    </section>
  );
}

const Skeleton = ({ h = "h-40" }: { h?: string }) => <div className={`card ${h} animate-pulse`} />;

export default function Home({ searchParams }: PageProps<"/">) {
  const sp = searchParams as Promise<Record<string, string | undefined>>;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Applications</h1>
        <p className="mt-1 text-neutral-500">Your recruiting pipeline, built from your inbox.</p>
      </div>
      <Suspense>
        <Banner searchParams={sp} />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-24 mb-6" />}>
        <Stats />
      </Suspense>
      <div className="mb-6 grid items-start gap-6 lg:grid-cols-5">
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
