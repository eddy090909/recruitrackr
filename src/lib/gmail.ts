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

/* ---------------------------- fetching ----------------------------- */

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

export async function fetchCandidateEmails(sinceIso: string, limit = Infinity): Promise<{ emails: RawEmail[]; remaining: number }> {
  const gmail = google.gmail({ version: "v1", auth: await oauthClient() });
  const db = await getDb();
  const known = (await db.query<{ domain: string }>("SELECT DISTINCT domain FROM app_domains")).map((r) => r.domain);
  const queries = buildQueries(Math.floor(Date.parse(sinceIso) / 1000), known);

  const ids = new Map<string, string | null>();
  for (const q of queries) {
    let pageToken: string | undefined;
    do {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
      for (const m of res.data.messages ?? []) if (m.id) ids.set(m.id, m.threadId ?? null);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  // Skip messages we've already processed.
  const seen = new Set((await db.query<{ gmail_id: string }>("SELECT gmail_id FROM emails")).map((r) => r.gmail_id));
  const unseen = [...ids.keys()].filter((id) => !seen.has(id));
  // Gmail lists newest first; process the oldest first so timelines build in order across batches.
  unseen.reverse();
  const todo = unseen.slice(0, limit);

  const out: RawEmail[] = [];
  const BATCH = 10;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = await Promise.all(
      todo.slice(i, i + BATCH).map((id) => gmail.users.messages.get({ userId: "me", id, format: "full" })),
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
  return { emails: out.sort((a, b) => a.date.localeCompare(b.date)), remaining: unseen.length - todo.length };
}
