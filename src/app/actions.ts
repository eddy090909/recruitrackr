"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { isDemo, requireUser } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/secure";
import { runSync, type SyncSummary } from "@/lib/sync";
import { ingestEmail, STATUSES, type Status } from "@/lib/ingest";
import { CATEGORIES, type Category, type Classification } from "@/lib/classify";
import { companyKey, httpUrl, roleKey } from "@/lib/normalize";

// Every action checks the session first: server actions are reachable by direct POST.

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const toIso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const done = () => revalidatePath("/", "layout");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function syncNow(_prev: unknown): Promise<{ ok: boolean; message: string; summary?: SyncSummary }> {
  await requireUser();
  if (isDemo()) return { ok: false, message: "Demo mode: sync is disabled." };
  try {
    const s = await runSync();
    done();
    const more = s.remaining ? ` · ${s.remaining} more on the next sync` : "";
    return { ok: true, summary: s, message: `Fetched ${s.fetched} new emails · ${s.linked} linked · ${s.review} to review · ${s.ignored} ignored${more}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: /invalid_grant|not connected/i.test(msg) ? "Gmail access expired. Sign out and sign in again." : msg };
  }
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function addApplication(form: FormData) {
  await requireUser();
  const company = str(form, "company");
  if (!company) return;
  const role = str(form, "role");
  const status = (str(form, "status") as Status) ?? "applied";
  if (!STATUSES.includes(status)) return;
  const now = new Date().toISOString();
  const db = await getDb();
  await db.tx(async (t) => {
    const row = await t.one<{ id: number }>(
      `INSERT INTO applications(company, company_key, role, role_key, status, applied_at, last_update_at, job_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [company, companyKey(company), role, roleKey(role) || null, status, status === "saved" ? null : now, now, httpUrl(str(form, "job_url"))],
    );
    await t.query("INSERT INTO status_events(application_id, status, occurred_at) VALUES ($1, $2, $3)", [row!.id, status, now]);
  });
  done();
}

async function setStatus(id: number, status: Status) {
  if (!STATUSES.includes(status)) return;
  await (await getDb()).tx(async (db) => {
    const cur = await db.one<{ status: Status }>("SELECT status FROM applications WHERE id = $1 FOR UPDATE", [id]);
    if (!cur || cur.status === status) return;
    const now = new Date().toISOString();
    await db.query("UPDATE applications SET status = $1, last_update_at = $2, updated_at = now() WHERE id = $3", [status, now, id]);
    await db.query("INSERT INTO status_events(application_id, status, occurred_at) VALUES ($1, $2, $3)", [id, status, now]);
  });
}

export async function updateApplication(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  const company = str(form, "company");
  const role = str(form, "role");
  await (await getDb()).query(
    `UPDATE applications SET
       company = COALESCE($1, company), company_key = COALESCE($2, company_key),
       role = $3, role_key = $4, job_url = $5, notes = $6, updated_at = now()
     WHERE id = $7`,
    [company, company ? companyKey(company) : null, role, roleKey(role) || null, httpUrl(str(form, "job_url")), str(form, "notes"), id],
  );
  const status = str(form, "status") as Status | null;
  if (status) await setStatus(id, status);
  done();
}

export async function quickStatus(form: FormData) {
  await requireUser();
  await setStatus(Number(form.get("id")), form.get("status") as Status);
  done();
}

export async function deleteApplication(form: FormData) {
  await requireUser();
  await (await getDb()).query("DELETE FROM applications WHERE id = $1", [Number(form.get("id"))]);
  done();
  redirect("/");
}

export async function toggleAction(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  const db = await getDb();
  const row = await db.one<{ done: boolean }>("UPDATE action_items SET done = NOT done WHERE id = $1 RETURNING done", [id]);
  if (row) await db.query("UPDATE tasks SET done = $1 WHERE dedupe_key = $2", [row.done, `action:${id}`]);
  done();
}

export async function toggleTask(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  const db = await getDb();
  const row = await db.one<{ done: boolean; dedupe_key: string | null }>("UPDATE tasks SET done = NOT done WHERE id = $1 RETURNING done, dedupe_key", [id]);
  if (row?.dedupe_key?.startsWith("action:")) await db.query("UPDATE action_items SET done = $1 WHERE id = $2", [row.done, Number(row.dedupe_key.slice(7))]);
  done();
}

export async function addTask(form: FormData) {
  await requireUser();
  const title = str(form, "title");
  if (!title) return;
  const appId = str(form, "application_id");
  await (await getDb()).query("INSERT INTO tasks(title, due_at, application_id, source) VALUES ($1, $2, $3, 'manual')", [
    title,
    toIso(str(form, "due_at")),
    appId ? Number(appId) : null,
  ]);
  done();
}

export async function addActionItem(form: FormData) {
  await requireUser();
  const appId = Number(form.get("application_id"));
  const description = str(form, "description");
  if (!description) return;
  const due = toIso(str(form, "due_at"));
  const db = await getDb();
  const row = await db.one<{ id: number }>(
    "INSERT INTO action_items(application_id, type, description, link, due_at, created_at) VALUES ($1, 'other', $2, $3, $4, now()) RETURNING id",
    [appId, description, httpUrl(str(form, "link")), due],
  );
  if (due && row) {
    const app = await db.one<{ company: string }>("SELECT company FROM applications WHERE id = $1", [appId]);
    await db.query(
      "INSERT INTO tasks(title, due_at, application_id, source, dedupe_key) VALUES ($1, $2, $3, 'manual', $4) ON CONFLICT (dedupe_key) DO NOTHING",
      [`${app?.company}: ${description}`, due, appId, `action:${row.id}`],
    );
  }
  done();
}

/** Confirm or correct a low-confidence email, then apply it. */
export async function resolveReview(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  const db = await getDb();
  const row = await db.one<{ gmail_id: string; thread_id: string | null; subject: string; sender: string; date: string; snippet: string; extracted: string | null }>(
    "SELECT * FROM emails WHERE id = $1",
    [id],
  );
  if (!row) return;
  const prior: Classification = row.extracted
    ? JSON.parse(row.extracted)
    : { category: "update_other", company: null, role: null, actionItems: [], deadline: null, interviewAt: null, confidence: 0 };
  const category = (str(form, "category") as Category) ?? prior.category;
  const corrected: Classification = {
    ...prior,
    category: CATEGORIES.includes(category) ? category : prior.category,
    company: str(form, "company") ?? prior.company,
    role: str(form, "role") ?? prior.role,
    confidence: 1,
  };
  if (corrected.category === "not_recruiting") {
    await db.query("UPDATE emails SET dismissed = true, needs_review = false, category = 'not_recruiting' WHERE id = $1", [id]);
  } else {
    await ingestEmail(
      { gmailId: row.gmail_id, threadId: row.thread_id, subject: row.subject, sender: row.sender, date: row.date, snippet: row.snippet, body: row.snippet ?? "" },
      corrected,
      { force: true },
    );
  }
  done();
}

export async function dismissReview(form: FormData) {
  await requireUser();
  await (await getDb()).query("UPDATE emails SET dismissed = true, needs_review = false WHERE id = $1", [Number(form.get("id"))]);
  done();
}
