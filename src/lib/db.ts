import path from "node:path";
import fs from "node:fs";
import postgres from "postgres";
import type { PGlite } from "@electric-sql/pglite";

/**
 * Database access.
 * - Production / any env with DATABASE_URL → real Postgres (e.g. Neon) via postgres.js.
 * - Local dev without DATABASE_URL → embedded Postgres (PGlite) stored in ./data, zero setup.
 * Both speak the same SQL, so the rest of the app only sees `query` and `tx`.
 */

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  company TEXT NOT NULL,
  company_key TEXT NOT NULL,
  role TEXT,
  role_key TEXT,
  status TEXT NOT NULL DEFAULT 'applied',
  applied_at TIMESTAMPTZ,
  last_update_at TIMESTAMPTZ,
  job_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_company ON applications(company_key);

CREATE TABLE IF NOT EXISTS app_domains (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  PRIMARY KEY (application_id, domain)
);

CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  gmail_id TEXT NOT NULL UNIQUE,
  thread_id TEXT,
  subject TEXT,
  sender TEXT,
  sender_domain TEXT,
  date TIMESTAMPTZ NOT NULL,
  snippet TEXT,
  category TEXT,
  confidence REAL,
  extracted TEXT,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  dismissed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_email_thread ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_app ON emails(application_id);

CREATE TABLE IF NOT EXISTS status_events (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS action_items (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  link TEXT,
  due_at TIMESTAMPTZ,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  done BOOLEAN NOT NULL DEFAULT false,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  dedupe_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

/** Timestamps come back as Date objects; the app works with ISO strings everywhere. */
function normalizeRow<T>(row: Record<string, unknown>): T {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Date) row[k] = v.toISOString();
  }
  return row as T;
}

function fromPostgres(sql: postgres.Sql | postgres.TransactionSql): Db {
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return (rows as unknown as Record<string, unknown>[]).map((r) => normalizeRow<T>({ ...r }));
    },
    async one<T>(text: string, params: unknown[] = []) {
      return (await db.query<T>(text, params))[0];
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if ("begin" in sql) return (await sql.begin((t) => fn(fromPostgres(t)))) as T;
      return fn(db); // already inside a transaction
    },
  };
  return db;
}

type PgliteLike = Pick<PGlite, "query" | "exec"> & { transaction?: PGlite["transaction"] };

function fromPglite(pg: PgliteLike): Db {
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query<Record<string, unknown>>(text, params);
      return res.rows.map((r) => normalizeRow<T>({ ...r }));
    },
    async one<T>(text: string, params: unknown[] = []) {
      return (await db.query<T>(text, params))[0];
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (pg.transaction) return pg.transaction((t) => fn(fromPglite(t as unknown as PgliteLike)));
      return fn(db);
    },
  };
  return db;
}

async function migrate(db: Db) {
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
}

/** Create a database handle. `target` = "memory" for tests, a directory for PGlite, or a Postgres URL. */
export async function createDb(target?: string): Promise<Db> {
  const url = target ?? process.env.DATABASE_URL;
  let db: Db;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const sql = postgres(url, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
    db = fromPostgres(sql);
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    let dir: string | undefined;
    if (url !== "memory") {
      dir = url || process.env.PGLITE_DIR || path.join(process.cwd(), "data", "pglite");
      fs.mkdirSync(path.dirname(dir), { recursive: true });
    }
    db = fromPglite(await PGlite.create(dir));
  }
  await migrate(db);
  return db;
}

const globalForDb = globalThis as unknown as { __recruitrackrDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__recruitrackrDb) globalForDb.__recruitrackrDb = createDb();
  return globalForDb.__recruitrackrDb;
}

/** Swap the shared instance (tests and scripts). */
export function setDb(db: Db) {
  globalForDb.__recruitrackrDb = Promise.resolve(db);
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await (await getDb()).one<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null) {
  const db = await getDb();
  if (value === null) await db.query("DELETE FROM settings WHERE key = $1", [key]);
  else await db.query("INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}
