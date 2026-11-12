import { connection } from "next/server";
import { getDb, getSetting } from "./db";
import { requireUser } from "./auth";
import type { Status } from "./ingest";

export const NO_RESPONSE_DAYS = 21;

export interface ApplicationRow {
  id: number;
  company: string;
  role: string | null;
  status: Status;
  applied_at: string | null;
  last_update_at: string | null;
  job_url: string | null;
  notes: string | null;
  open_actions: number;
  next_due: string | null;
  email_count: number;
}

export interface ActionItemRow {
  id: number;
  application_id: number;
  company: string;
  role: string | null;
  type: string;
  description: string;
  link: string | null;
  due_at: string | null;
  done: boolean;
  created_at: string;
  /** Has a deadline within the next week (or already past). Set by listOpenActions. */
  due_this_week?: boolean;
}

export interface TaskRow {
  id: number;
  title: string;
  due_at: string | null;
  done: boolean;
  application_id: number | null;
  company: string | null;
  source: string;
}

export interface EmailRow {
  id: number;
  gmail_id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  category: string;
  confidence: number;
  extracted: string | null;
  application_id: number | null;
}

export function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

export function isNoResponse(a: Pick<ApplicationRow, "status" | "last_update_at">) {
  const d = daysSince(a.last_update_at);
  return a.status === "applied" && d !== null && d >= NO_RESPONSE_DAYS;
}

/** Every read is request-time (not prerendered) and requires the signed-in owner. */
async function db() {
  await connection();
  await requireUser();
  return getDb();
}

export async function listApplications(filter: { status?: string; q?: string } = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  const p = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (filter.status === "no_response") {
    where.push(`a.status = 'applied' AND a.last_update_at <= now() - make_interval(days => ${p(NO_RESPONSE_DAYS)})`);
  } else if (filter.status === "action") {
    where.push("EXISTS (SELECT 1 FROM action_items x WHERE x.application_id = a.id AND NOT x.done)");
  } else if (filter.status === "active") {
    where.push("a.status <> 'rejected'");
  } else if (filter.status && filter.status !== "all") {
    where.push(`a.status = ${p(filter.status)}`);
  }
  if (filter.q) {
    const q = p(`%${filter.q}%`);
    where.push(`(a.company ILIKE ${q} OR a.role ILIKE ${q})`);
  }
  return (await db()).query<ApplicationRow>(
    `SELECT a.*,
      (SELECT COUNT(*)::int FROM action_items x WHERE x.application_id = a.id AND NOT x.done) AS open_actions,
      (SELECT MIN(due_at) FROM tasks t WHERE t.application_id = a.id AND NOT t.done AND t.due_at >= now() - interval '1 day') AS next_due,
      (SELECT COUNT(*)::int FROM emails e WHERE e.application_id = a.id) AS email_count
     FROM applications a
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY (SELECT COUNT(*) FROM action_items x WHERE x.application_id = a.id AND NOT x.done) > 0 DESC,
              COALESCE(a.last_update_at, a.created_at) DESC`,
    args,
  );
}

export async function getStats() {
  const d = await db();
  const rows = await d.query<{ status: Status; n: number }>("SELECT status, COUNT(*)::int AS n FROM applications GROUP BY status");
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<Status, number>>;
  const total = rows.reduce((s, r) => s + r.n, 0);
  const responded = (by.oa ?? 0) + (by.interview ?? 0) + (by.offer ?? 0) + (by.rejected ?? 0);
  const noResponse =
    (
      await d.one<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM applications WHERE status = 'applied' AND last_update_at <= now() - make_interval(days => $1)",
        [NO_RESPONSE_DAYS],
      )
    )?.n ?? 0;
  return { total, by, responseRate: total ? responded / total : 0, noResponse };
}

export async function listOpenActions(weekDays = 7) {
  return (await db()).query<ActionItemRow>(
    `SELECT x.*, a.company, a.role, COALESCE(x.due_at <= now() + make_interval(days => $1), false) AS due_this_week
     FROM action_items x JOIN applications a ON a.id = x.application_id
     WHERE NOT x.done ORDER BY x.due_at ASC NULLS LAST, x.created_at DESC`,
    [weekDays],
  );
}

export async function listDueSoon(days = 7) {
  return (await db()).query<TaskRow>(
    `SELECT t.*, a.company FROM tasks t LEFT JOIN applications a ON a.id = t.application_id
     WHERE NOT t.done AND t.due_at IS NOT NULL AND t.due_at <= now() + make_interval(days => $1)
       -- Deadlines of open action items already appear in the Action needed panel.
       AND (t.dedupe_key IS NULL OR t.dedupe_key NOT LIKE 'action:%')
     ORDER BY t.due_at`,
    [days],
  );
}

export async function getApplication(id: number) {
  if (!Number.isInteger(id)) return null;
  const d = await db();
  const app = await d.one<ApplicationRow>("SELECT * FROM applications WHERE id = $1", [id]);
  if (!app) return null;
  const [events, actions, emails, tasks, domains] = await Promise.all([
    d.query<{ id: number; status: Status; occurred_at: string; email_id: number | null; subject: string | null }>(
      "SELECT s.*, e.subject FROM status_events s LEFT JOIN emails e ON e.id = s.email_id WHERE s.application_id = $1 ORDER BY s.occurred_at",
      [id],
    ),
    d.query<ActionItemRow>("SELECT x.*, '' AS company, NULL AS role FROM action_items x WHERE application_id = $1 ORDER BY created_at", [id]),
    d.query<EmailRow>("SELECT * FROM emails WHERE application_id = $1 ORDER BY date DESC", [id]),
    d.query<TaskRow>("SELECT t.*, NULL AS company FROM tasks t WHERE application_id = $1 ORDER BY done, due_at", [id]),
    d.query<{ domain: string }>("SELECT domain FROM app_domains WHERE application_id = $1", [id]),
  ]);
  return { app, events, actions, emails, tasks, domains: domains.map((r) => r.domain) };
}

export async function listReview() {
  return (await db()).query<EmailRow>("SELECT * FROM emails WHERE needs_review AND NOT dismissed ORDER BY date DESC");
}

export async function getConnection() {
  const d = await db();
  const [tokens, email, lastSyncAt, summary, review] = await Promise.all([
    getSetting("google_tokens"),
    getSetting("google_email"),
    getSetting("last_sync_ran_at"),
    getSetting("last_sync_summary"),
    d.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM emails WHERE needs_review AND NOT dismissed"),
  ]);
  return {
    connected: Boolean(tokens),
    email,
    lastSyncAt,
    lastSummary: summary ? JSON.parse(summary) : null,
    llm: Boolean(process.env.ANTHROPIC_API_KEY),
    reviewCount: review?.n ?? 0,
  };
}
