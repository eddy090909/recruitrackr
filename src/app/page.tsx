import Link from "next/link";
import { Suspense } from "react";
import { addApplication, toggleAction, toggleTask } from "./actions";
import { getStats, isNoResponse, listApplications, listDueSoon, listOpenActions, daysSince, type ActionItemRow, type TaskRow } from "@/lib/queries";
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

const WEEK_DAYS = 7;
const DAY = 86_400_000;

/** "Overdue", "Today", "Tomorrow", then the weekday ("Thursday, Nov 13"). */
function dayGroup(iso: string) {
  const due = new Date(iso);
  if (due.getTime() < Date.now()) return "Overdue";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.floor((due.getTime() - start.getTime()) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return due.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function dueTime(iso: string) {
  const d = new Date(iso);
  return d.getHours() === 23 && d.getMinutes() === 59 ? "End of day" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

type WeekItem = { kind: "action"; due: string; a: ActionItemRow } | { kind: "task"; due: string; t: TaskRow };

function ActionCard({ a }: { a: ActionItemRow }) {
  return (
    <li className="card-inner border-l-4 border-red-600 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/applications/${a.application_id}`} className="text-base font-semibold hover:underline">
            {a.company}
          </Link>
          <div className="text-xs text-neutral-500">{a.role ?? a.type}</div>
        </div>
        <div className={`shrink-0 text-right text-xs ${dueTone(a.due_at)}`}>
          {a.due_at ? `${dueTime(a.due_at)} · ${relDays(a.due_at)}` : <span className="text-neutral-400">No deadline</span>}
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
  );
}

function TaskCard({ t }: { t: TaskRow }) {
  return (
    <li className="card-inner flex items-center gap-3 px-4 py-3">
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
      <div className={`shrink-0 text-xs ${dueTone(t.due_at)}`}>
        {t.due_at && `${dueTime(t.due_at)} · ${relDays(t.due_at)}`}
      </div>
    </li>
  );
}

/** Everything with a deadline in the next week (or already missed), then open actions without one. */
async function ThisWeek() {
  const [actions, tasks] = await Promise.all([listOpenActions(WEEK_DAYS), listDueSoon(WEEK_DAYS)]);
  const week: WeekItem[] = [
    ...actions.filter((a) => a.due_this_week).map((a) => ({ kind: "action" as const, due: a.due_at!, a })),
    ...tasks.map((t) => ({ kind: "task" as const, due: t.due_at!, t })),
  ].sort((x, y) => x.due.localeCompare(y.due));
  const later = actions.filter((a) => !a.due_this_week);

  const groups = new Map<string, WeekItem[]>();
  for (const item of week) {
    const g = dayGroup(item.due);
    groups.set(g, [...(groups.get(g) ?? []), item]);
  }

  return (
    <>
      <section className="card mb-6 px-5 py-5">
        <div className="mb-4 flex items-center justify-between px-1">
          <h2 className={`${week.length ? "label-urgent" : "label"} flex items-center gap-2`}>
            {week.length > 0 && <span className="h-2 w-2 rounded-full bg-red-600" />}
            Due this week
          </h2>
          {week.length > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white tabular-nums">{week.length}</span>}
        </div>
        {week.length === 0 ? (
          <p className="card-inner px-4 py-6 text-sm text-neutral-500">Nothing due in the next 7 days.</p>
        ) : (
          <div className="space-y-5">
            {[...groups].map(([label, items]) => (
              <div key={label}>
                <h3 className={`mb-2 px-1 text-xs font-semibold ${label === "Overdue" ? "text-red-600" : "text-neutral-500"}`}>
                  {label} <span className="font-normal text-neutral-400">· {items.length}</span>
                </h3>
                <ul className="grid gap-3 md:grid-cols-2">
                  {items.map((item) => (item.kind === "action" ? <ActionCard key={`a${item.a.id}`} a={item.a} /> : <TaskCard key={`t${item.t.id}`} t={item.t} />))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      {later.length > 0 && (
        <section className="card mb-6 px-5 py-5">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="label">Other open actions</h2>
            <span className="text-xs text-neutral-500 tabular-nums">{later.length}</span>
          </div>
          <ul className="card-inner divide-y divide-neutral-100">
            {later.slice(0, 5).map((a) => (
              <LaterRow key={a.id} a={a} />
            ))}
          </ul>
          {later.length > 5 && (
            <details className="mt-2">
              <summary className="cursor-pointer px-1 text-xs font-medium text-neutral-500 hover:text-black">Show {later.length - 5} more</summary>
              <ul className="card-inner mt-2 divide-y divide-neutral-100">
                {later.slice(5).map((a) => (
                  <LaterRow key={a.id} a={a} />
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}

function LaterRow({ a }: { a: ActionItemRow }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <form action={toggleAction}>
        <input type="hidden" name="id" value={a.id} />
        <button title="Mark done" aria-label={`Mark "${a.description}" done for ${a.company}`} className="h-4 w-4 rounded-full ring-1 ring-neutral-300 hover:bg-neutral-100" />
      </form>
      <Link href={`/applications/${a.application_id}`} className="shrink-0 font-semibold hover:underline">
        {a.company}
      </Link>
      <span className="min-w-0 flex-1 truncate text-neutral-600" title={a.description}>
        {a.description}
      </span>
      {a.link && (
        <a href={a.link} target="_blank" rel="noreferrer" className="link-out shrink-0 text-xs">
          {linkLabel(a.type)} ↗
        </a>
      )}
      <span className="shrink-0 text-xs text-neutral-400">{a.due_at ? fmtDate(a.due_at) : "No deadline"}</span>
    </li>
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
      <Suspense fallback={<Skeleton h="h-48 mb-6" />}>
        <ThisWeek />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-24 mb-6" />}>
        <Stats />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-96" />}>
        <ApplicationsTable searchParams={sp} />
      </Suspense>
    </>
  );
}
