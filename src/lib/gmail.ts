import { google, type gmail_v1 } from "googleapis";
import { getDb, getSetting, setSetting } from "./db";
import { decrypt, encrypt } from "./secure";
import type { RawEmail } from "./classify";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"];

export function redirectUri(origin?: string) {
  return process.env.GOOGLE_REDIRECT_URI || `${origin ?? process.env.APP_URL ?? "http://localhost:3000"}/api/auth/callback`;
}

function baseClient(origin?: string) {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  return new google.auth.OAuth2(id, secret, redirectUri(origin));
}

async function loadTokens() {
  const saved = await getSetting("google_tokens");
  if (!saved) return null;
  try {
    return JSON.parse(decrypt(saved));
  } catch {
    return null; // secret changed or old plaintext → user signs in again
  }
}

async function saveTokens(tokens: object) {
  await setSetting("google_tokens", encrypt(JSON.stringify(tokens)));
}

/** OAuth client loaded with the stored (encrypted) tokens; refreshed tokens are saved back. */
export async function oauthClient() {
  const client = baseClient();
  const tokens = await loadTokens();
  if (!tokens) throw new Error("Gmail is not connected. Sign in again.");
  client.setCredentials(tokens);
  client.on("tokens", (fresh) => {
    void saveTokens({ ...tokens, ...fresh });
  });
  return client;
}

export async function authUrl(state: string, origin?: string) {
  // Only force the consent screen when we don't have a refresh token yet.
  const hasRefresh = Boolean((await loadTokens())?.refresh_token);
  return baseClient(origin).generateAuthUrl({
    access_type: "offline",
    prompt: hasRefresh ? "select_account" : "consent",
    scope: SCOPES,
    state,
  });
}

/** Exchange the code, return the Google account's email. Tokens are only saved if the caller accepts the user. */
export async function exchangeCode(code: string, origin?: string) {
  const client = baseClient(origin);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
  return {
    email: (profile.data.emailAddress ?? "").toLowerCase(),
    save: async () => {
      const prev = await loadTokens();
      // Google only returns a refresh token on first consent; keep the old one otherwise.
      await saveTokens({ ...tokens, refresh_token: tokens.refresh_token ?? prev?.refresh_token });
      await setSetting("google_email", profile.data.emailAddress ?? "");
    },
  };
}

export async function isConnected() {
  return Boolean(await loadTokens());
}

/* ----------------------------- queries ----------------------------- */

const ATS_DOMAINS = [
  "greenhouse.io",
  "greenhouse-mail.io",
  "lever.co",
  "myworkday.com",
  "myworkdayjobs.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "icims.com",
  "jobvite.com",
  "successfactors.com",
  "taleo.net",
  "avature.net",
  "eightfold.ai",
  "hackerrank.com",
  "hackerrankforwork.com",
  "codesignal.com",
  "codility.com",
  "hirevue.com",
  "karat.io",
  "modernhire.com",
  "harver.com",
];

const CONFIRMATION_PHRASES = [
  "thank you for applying",
  "thanks for applying",
  "received your application",
  "application received",
  "we have received",
  "thank you for your interest",
  "application submitted",
  "your application to",
  "your application for",
];

const UPDATE_PHRASES = [
  "next steps",
  "online assessment",
  "coding challenge",
  "assessment",
  "interview",
  "unfortunately",
  "not moving forward",
  "other candidates",
  "offer",
  "action required",
  "please complete",
  "please fill",
  "before we can review",
  "still need to",
];

const quote = (p: string) => `"${p}"`;

/** Gmail search queries whose results are unioned. Kept short to stay under Gmail's query length limits. */
export function buildQueries(afterEpochSec: number, knownDomains: string[]): string[] {
  const after = ` after:${afterEpochSec} -in:chats -in:sent`;
  const queries = [
    `from:(${ATS_DOMAINS.join(" OR ")})${after}`,
    `{${CONFIRMATION_PHRASES.map(quote).join(" ")}}${after}`,
    `{${UPDATE_PHRASES.map(quote).join(" ")}} {application applied candidate position role internship}${after}`,
  ];
  for (let i = 0; i < knownDomains.length; i += 25) {
    queries.push(`from:(${knownDomains.slice(i, i + 25).join(" OR ")})${after}`);
  }
  return queries;
}

function decode(data?: string | null) {
  return data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";
}

/** HTML → text, keeping link targets so the classifier can return exact URLs. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => `${text.replace(/<[^>]+>/g, "").trim()} (${href})`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function extractBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return "";
  let plain = "";
  let html = "";
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = decode(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = decode(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(payload);
  // Prefer HTML (keeps hrefs) when the plain part has no links.
  if (html && (!plain || !/https?:\/\//.test(plain))) return htmlToText(html);
  return plain || htmlToText(html);
}

/* ------------------------- rate limits ---------------------------- */

export class GmailQuotaError extends Error {
  constructor() {
    super("Gmail is limiting requests right now. Wait a minute and sync again; progress is saved.");
    this.name = "GmailQuotaError";
  }
}

/** Gmail answers 429, or 403 with a rate-limit reason, when the per-minute quota is used up. */
export function isQuotaError(e: unknown): boolean {
  const err = e as { status?: number; code?: number | string; message?: string; errors?: { reason?: string }[] };
  const status = Number(err?.status ?? err?.code);
  if (status === 429) return true;
  const reasons = (err?.errors ?? []).map((x) => x.reason ?? "");
  return status === 403 && (reasons.some((r) => /rateLimitExceeded|quotaExceeded/i.test(r)) || /quota|rate limit/i.test(err?.message ?? ""));
}

function retryAfterMs(e: unknown): number | null {
  const h = (e as { response?: { headers?: Record<string, string> | Headers } })?.response?.headers;
  const v = h ? (typeof (h as Headers).get === "function" ? (h as Headers).get("retry-after") : (h as Record<string, string>)["retry-after"]) : null;
  const n = Number(v);
  return v && Number.isFinite(n) ? n * 1000 : null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a Gmail call when it hits the rate limit: honor Retry-After, else back off 2s, 4s, 8s, 16s, 32s. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const sleep = opts.sleep ?? wait;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      if (i + 1 >= attempts) throw new GmailQuotaError();
      await sleep(Math.min(retryAfterMs(e) ?? 2000 * 2 ** i, 60_000));
    }
  }
}

/* ---------------------------- fetching ----------------------------- */

/**
 * IDs of candidate recruiting emails since `sinceIso` that haven't been processed yet, oldest first.
 * Searching is the expensive part of a sync, so callers keep this list and work through it over several runs.
 */
export async function listCandidateIds(sinceIso: string): Promise<string[]> {
  const gmail = google.gmail({ version: "v1", auth: await oauthClient() });
  const db = await getDb();
  const known = (await db.query<{ domain: string }>("SELECT DISTINCT domain FROM app_domains")).map((r) => r.domain);
  const queries = buildQueries(Math.floor(Date.parse(sinceIso) / 1000), known);

  const ids = new Set<string>();
  for (const q of queries) {
    let pageToken: string | undefined;
    do {
      const res = await withRetry(() => gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken }));
      for (const m of res.data.messages ?? []) if (m.id) ids.add(m.id);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  const seen = new Set((await db.query<{ gmail_id: string }>("SELECT gmail_id FROM emails")).map((r) => r.gmail_id));
  // Gmail lists newest first; process the oldest first so timelines build in order across runs.
  return [...ids].filter((id) => !seen.has(id)).reverse();
}

/** Download messages by ID (a few at a time, retrying on rate limits). */
export async function fetchEmails(ids: string[]): Promise<RawEmail[]> {
  const gmail = google.gmail({ version: "v1", auth: await oauthClient() });
  const out: RawEmail[] = [];
  const BATCH = 5;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = await Promise.all(
      ids.slice(i, i + BATCH).map((id) => withRetry(() => gmail.users.messages.get({ userId: "me", id, format: "full" }))),
    );
    for (const { data } of chunk) {
      const h = (name: string) => data.payload?.headers?.find((x) => x.name?.toLowerCase() === name)?.value ?? "";
      out.push({
        gmailId: data.id!,
        threadId: data.threadId ?? null,
        subject: h("subject"),
        sender: h("from"),
        date: new Date(Number(data.internalDate)).toISOString(),
        snippet: data.snippet ?? "",
        body: extractBody(data.payload ?? undefined),
        bulk: Boolean(h("list-unsubscribe") || h("list-id")) || /^(bulk|list)$/i.test(h("precedence").trim()),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
