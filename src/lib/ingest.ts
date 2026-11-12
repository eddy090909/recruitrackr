import { getDb, type Db } from "./db";
import type { Category, Classification, RawEmail } from "./classify";
import { companyKey, emailDomain, httpUrl, isPlatformDomain, roleKey, rolesMatch, rootDomain } from "./normalize";

export const STATUSES = ["saved", "applied", "oa", "interview", "offer", "rejected"] as const;
export type Status = (typeof STATUSES)[number];

const RANK: Record<Status, number> = { saved: 0, applied: 1, oa: 2, interview: 3, offer: 4, rejected: 4 };
const TERMINAL: Status[] = ["offer", "rejected"];

export const CATEGORY_TO_STATUS: Partial<Record<Category, Status>> = {
  confirmation: "applied",
  oa: "oa",
  interview: "interview",
  rejection: "rejected",
  offer: "offer",
};

export const REVIEW_THRESHOLD = 0.7;

/** Status only moves forward; offer/rejected are terminal. */
export function nextStatus(current: Status, incoming: Status): Status {
  if (TERMINAL.includes(current)) return current;
  if (TERMINAL.includes(incoming)) return incoming;
  return RANK[incoming] > RANK[current] ? incoming : current;
}

interface AppRow {
  id: number;
  company: string;
  company_key: string;
  role: string | null;
  status: Status;
  applied_at: string | null;
  last_update_at: string | null;
}

/** Find the application an email belongs to, or null. */
export async function findApplication(db: Db, email: RawEmail, c: Pick<Classification, "company" | "role">): Promise<AppRow | null> {
  // 1. Same Gmail thread as an already-linked email.
  if (email.threadId) {
    const byThread = await db.one<AppRow>(
      "SELECT a.* FROM emails e JOIN applications a ON a.id = e.application_id WHERE e.thread_id = $1 LIMIT 1",
      [email.threadId],
    );
    if (byThread) return byThread;
  }

  // 2. Company (from classification, or from a known sender domain).
  let candidates: AppRow[] = [];
  const key = companyKey(c.company);
  if (key) {
    candidates = await db.query<AppRow>("SELECT * FROM applications WHERE company_key = $1 ORDER BY last_update_at DESC NULLS LAST", [key]);
  }
  if (!candidates.length) {
    const domain = emailDomain(email.sender);
    if (domain && !isPlatformDomain(domain)) {
      candidates = await db.query<AppRow>(
        "SELECT a.* FROM app_domains d JOIN applications a ON a.id = d.application_id WHERE d.domain = $1 ORDER BY a.last_update_at DESC NULLS LAST",
        [rootDomain(domain)],
      );
    }
  }
  if (!candidates.length) return null;

  // 3. Narrow by role.
  if (c.role) {
    const exact = candidates.find((a) => rolesMatch(a.role, c.role));
    if (exact) return exact;
    const roleless = candidates.find((a) => !a.role);
    if (roleless) return roleless;
    return null; // different role at the same company → new application
  }
  return candidates[0];
}

/** Action items from emails stop being actionable: past their deadline by this much, or this old with no deadline. */
export const ACTION_GRACE_DAYS = 3;
export const ACTION_UNDATED_DAYS = 30;

function isStale(dueAt: string | null, createdAt: string, now = Date.now()): boolean {
  const day = 86_400_000;
  return dueAt ? Date.parse(dueAt) < now - ACTION_GRACE_DAYS * day : Date.parse(createdAt) < now - ACTION_UNDATED_DAYS * day;
}

async function closeActionTasks(db: Db, items: { id: number }[]) {
  await db.query("UPDATE tasks SET done = true WHERE NOT done AND dedupe_key = ANY(string_to_array($1::text, ','))", [
    items.map((r) => `action:${r.id}`).join(","),
  ]);
}

/**
 * Close email-derived action items that no longer need doing: well past their deadline, old with no
 * deadline, or on an application that already ended (offer/rejected). Their deadline tasks close too.
 * Items added by hand are left alone. Returns how many items were closed.
 */
export async function closeStaleActions(db?: Db): Promise<number> {
  const d = db ?? (await getDb());
  const closed = await d.query<{ id: number }>(
    `UPDATE action_items x SET done = true
     WHERE NOT x.done AND x.email_id IS NOT NULL AND (
       x.due_at < now() - make_interval(days => $1)
       OR (x.due_at IS NULL AND x.created_at < now() - make_interval(days => $2))
       OR x.application_id IN (SELECT id FROM applications WHERE status IN ('offer', 'rejected'))
     ) RETURNING x.id`,
    [ACTION_GRACE_DAYS, ACTION_UNDATED_DAYS],
  );
  if (closed.length)
    await closeActionTasks(d, closed);
  return closed.length;
}

async function addTask(db: Db, title: string, dueAt: string | null, applicationId: number, dedupeKey: string) {
  await db.query(
    "INSERT INTO tasks(title, due_at, application_id, source, dedupe_key) VALUES ($1, $2, $3, 'auto', $4) ON CONFLICT (dedupe_key) DO NOTHING",
    [title, dueAt, applicationId, dedupeKey],
  );
}

export interface IngestResult {
  emailId: number | null;
  applicationId: number | null;
  skipped: boolean;
  needsReview: boolean;
}

/**
 * Store one classified email and apply it: link/create the application,
 * advance status, record timeline events, action items and tasks.
 */
export async function ingestEmail(email: RawEmail, c: Classification, opts: { force?: boolean } = {}): Promise<IngestResult> {
  const root = await getDb();
  const existing = await root.one<{ id: number }>("SELECT id FROM emails WHERE gmail_id = $1", [email.gmailId]);
  if (existing && !opts.force) return { emailId: existing.id, applicationId: null, skipped: true, needsReview: false };

  if (c.category === "not_recruiting") {
    // Remember it so we never re-classify it, but keep nothing else.
    await root.query(
      `INSERT INTO emails(gmail_id, thread_id, subject, sender, sender_domain, date, category, confidence, dismissed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) ON CONFLICT (gmail_id) DO NOTHING`,
      [email.gmailId, email.threadId ?? null, email.subject, email.sender, emailDomain(email.sender), email.date, c.category, c.confidence],
    );
    return { emailId: null, applicationId: null, skipped: true, needsReview: false };
  }

  return root.tx(async (db): Promise<IngestResult> => {
    let app = await findApplication(db, email, c);
    const status = CATEGORY_TO_STATUS[c.category];
    const lowConfidence = c.confidence < REVIEW_THRESHOLD && !opts.force;

    if (!app && c.company && !lowConfidence && (c.category !== "update_other" || opts.force)) {
      app = (await db.one<AppRow>(
        `INSERT INTO applications(company, company_key, role, role_key, status, applied_at, last_update_at)
         VALUES ($1, $2, $3, $4, 'applied', $5, $5) RETURNING *`,
        [c.company, companyKey(c.company), c.role, roleKey(c.role) || null, email.date],
      ))!;
      await db.query("INSERT INTO status_events(application_id, status, occurred_at) VALUES ($1, 'applied', $2)", [app.id, email.date]);
    }

    const needsReview = !app || lowConfidence;
    const extracted = JSON.stringify(c);
    let emailId: number;
    if (existing) {
      await db.query(
        "UPDATE emails SET category = $1, confidence = $2, extracted = $3, application_id = $4, needs_review = $5, dismissed = false WHERE id = $6",
        [c.category, c.confidence, extracted, app?.id ?? null, needsReview, existing.id],
      );
      emailId = existing.id;
    } else {
      emailId = (await db.one<{ id: number }>(
        `INSERT INTO emails(gmail_id, thread_id, subject, sender, sender_domain, date, snippet, category, confidence, extracted, application_id, needs_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          email.gmailId,
          email.threadId ?? null,
          email.subject,
          email.sender,
          emailDomain(email.sender),
          email.date,
          (email.snippet || email.body).slice(0, 300),
          c.category,
          c.confidence,
          extracted,
          app?.id ?? null,
          needsReview,
        ],
      ))!.id;
    }

    if (!app || lowConfidence) return { emailId, applicationId: app?.id ?? null, skipped: false, needsReview: true };

    // Remember the company's own sending domain so future emails from it get pulled and matched.
    const domain = emailDomain(email.sender);
    if (domain && !isPlatformDomain(domain)) {
      await db.query("INSERT INTO app_domains(application_id, domain) VALUES ($1, $2) ON CONFLICT DO NOTHING", [app.id, rootDomain(domain)]);
    }

    // Fill in a role we didn't know yet.
    if (!app.role && c.role) {
      await db.query("UPDATE applications SET role = $1, role_key = $2 WHERE id = $3", [c.role, roleKey(c.role), app.id]);
    }

    // Status + timeline.
    let newStatus = app.status;
    if (status) {
      newStatus = nextStatus(app.status, status);
      if (status === "applied") {
        // A confirmation sets the applied date (keep the earliest).
        await db.query("UPDATE applications SET applied_at = LEAST(COALESCE(applied_at, $1::timestamptz), $1::timestamptz) WHERE id = $2", [email.date, app.id]);
        const updated = await db.query(
          "UPDATE status_events SET email_id = COALESCE(email_id, $1), occurred_at = LEAST(occurred_at, $2::timestamptz) WHERE application_id = $3 AND status = 'applied' RETURNING id",
          [emailId, email.date, app.id],
        );
        if (!updated.length)
          await db.query("INSERT INTO status_events(application_id, status, email_id, occurred_at) VALUES ($1, 'applied', $2, $3)", [app.id, emailId, email.date]);
      } else if (newStatus === status) {
        const dup = await db.one("SELECT 1 FROM status_events WHERE application_id = $1 AND status = $2 AND email_id = $3", [app.id, status, emailId]);
        if (!dup)
          await db.query("INSERT INTO status_events(application_id, status, email_id, occurred_at) VALUES ($1, $2, $3, $4)", [app.id, status, emailId, email.date]);
      }
    }
    await db.query(
      "UPDATE applications SET status = $1, last_update_at = GREATEST(COALESCE(last_update_at, $2::timestamptz), $2::timestamptz), updated_at = now() WHERE id = $3",
      [newStatus, email.date, app.id],
    );

    // Action items (deduplicated by link, then by description).
    for (const raw of c.actionItems) {
      const item = { ...raw, link: httpUrl(raw.link) };
      const dup = item.link
        ? await db.one("SELECT id FROM action_items WHERE application_id = $1 AND link = $2", [app.id, item.link])
        : await db.one("SELECT id FROM action_items WHERE application_id = $1 AND lower(description) = lower($2)", [app.id, item.description]);
      if (dup) continue;
      // Old emails (first sync looks back months) bring requests that are long over: keep them as done.
      const done = TERMINAL.includes(newStatus) || isStale(item.dueAt, email.date);
      const aid = (await db.one<{ id: number }>(
        "INSERT INTO action_items(application_id, email_id, type, description, link, due_at, created_at, done) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [app.id, emailId, item.type, item.description, item.link, item.dueAt, email.date, done],
      ))!.id;
      if (item.dueAt && !done) await addTask(db, `${app.company}: ${item.description}`, item.dueAt, app.id, `action:${aid}`);
    }

    // Moving on makes earlier requests moot: an interview means the assessment is behind you,
    // and an offer or rejection ends everything that was still open.
    if (newStatus !== app.status) {
      const types = TERMINAL.includes(newStatus) ? null : newStatus === "interview" ? ["assessment"] : [];
      if (types === null || types.length) {
        const closed = await db.query<{ id: number }>(
          `UPDATE action_items SET done = true
           WHERE application_id = $1 AND NOT done AND email_id IS NOT NULL AND email_id <> $2 AND ($3::text IS NULL OR type = ANY(string_to_array($3::text, ',')))
           RETURNING id`,
          [app.id, emailId, types?.join(",") ?? null],
        );
        if (closed.length)
          await closeActionTasks(db, closed);
      }
    }

    if (c.interviewAt) await addTask(db, `${app.company} interview`, c.interviewAt, app.id, `interview:${app.id}:${c.interviewAt}`);
    if (c.deadline && !c.actionItems.some((a) => a.dueAt)) await addTask(db, `${app.company}: deadline`, c.deadline, app.id, `deadline:${app.id}:${c.deadline}`);

    return { emailId, applicationId: app.id, skipped: false, needsReview: false };
  });
}
