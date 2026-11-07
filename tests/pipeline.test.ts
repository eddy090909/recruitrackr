import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, getDb, setDb } from "@/lib/db";
import { decrypt, encrypt, createSessionToken, readSessionToken } from "@/lib/secure";
import { isDemo } from "@/lib/secure-constants";
import { loginErrorMessage } from "@/lib/login-errors";
import { classifyHeuristic, parseClassification, type Classification, type RawEmail } from "@/lib/classify";
import { ingestEmail, nextStatus } from "@/lib/ingest";
import { companyKey, httpUrl, isPlatformDomain, rolesMatch, rootDomain } from "@/lib/normalize";
import { buildQueries, htmlToText } from "@/lib/gmail";
import { demoEmails } from "../scripts/demo-emails";

const base: Classification = { category: "confirmation", company: "Acme", role: "Software Engineer Intern", actionItems: [], deadline: null, interviewAt: null, confidence: 0.95 };
const mail = (id: string, over: Partial<RawEmail> = {}): RawEmail => ({
  gmailId: id,
  threadId: `t-${id}`,
  subject: "s",
  sender: "Acme Careers <jobs@acme.com>",
  date: "2026-10-01T12:00:00.000Z",
  body: "",
  ...over,
});
const app = async () => (await getDb()).query<{ id: number; status: string; role: string }>("SELECT * FROM applications ORDER BY id");
const q = async (sql: string) => (await getDb()).query(sql);

// Runs on embedded Postgres (PGlite) by default; set TEST_DATABASE_URL to run against a real Postgres server.
let shared: Awaited<ReturnType<typeof createDb>> | undefined;
beforeEach(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return setDb(await createDb("memory"));
  shared ??= await createDb(url);
  await shared.query("TRUNCATE applications, app_domains, emails, status_events, action_items, tasks, settings RESTART IDENTITY CASCADE");
  setDb(shared);
});

describe("parseClassification", () => {
  it("parses fenced JSON and normalizes dates", async () => {
    const c = parseClassification('```json\n{"category":"oa","company":"Google","role":null,"actionItems":[{"type":"assessment","description":"Do OA","link":"https://x","dueAt":"2026-11-10"}],"deadline":"null","interviewAt":null,"confidence":0.9}\n```');
    expect(c.category).toBe("oa");
    expect(c.deadline).toBeNull();
    const due = new Date(c.actionItems[0].dueAt!);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours()]).toEqual([2026, 11, 10, 23]); // end of day, local
  });
  it("rejects unknown categories", async () => {
    expect(() => parseClassification('{"category":"maybe","company":"X","actionItems":[],"confidence":1}')).toThrow();
  });
  it("coerces unknown action types to other", async () => {
    const c = parseClassification('{"category":"action_required","company":"X","actionItems":[{"type":"survey","description":"fill it"}],"confidence":0.8}');
    expect(c.actionItems[0].type).toBe("other");
  });
});

describe("status rules", () => {
  it("only moves forward, terminal states stick", async () => {
    expect(nextStatus("applied", "oa")).toBe("oa");
    expect(nextStatus("interview", "applied")).toBe("interview");
    expect(nextStatus("oa", "rejected")).toBe("rejected");
    expect(nextStatus("rejected", "interview")).toBe("rejected");
    expect(nextStatus("offer", "rejected")).toBe("offer");
  });
});

describe("normalization", () => {
  it("normalizes company names and domains", async () => {
    expect(companyKey("Netflix, Inc.")).toBe("netflix");
    expect(companyKey("Google Staffing")).toBe("google");
    expect(rootDomain("mail.netflix.com")).toBe("netflix.com");
    expect(rolesMatch("Software Engineering Intern, BS, Summer 2027", "Software Engineering Intern")).toBe(true);
    expect(rolesMatch("Data Science Intern", "Software Engineering Intern")).toBe(false);
  });
  it("treats job platforms and university career offices as non-company domains", async () => {
    expect(isPlatformDomain("mail.greenhouse.io")).toBe(true);
    expect(isPlatformDomain("careers.example.edu")).toBe(true);
    expect(isPlatformDomain("netflix.com")).toBe(false);
  });
  it("keeps only http(s) links", async () => {
    expect(httpUrl("https://acme.com/form")).toBe("https://acme.com/form");
    expect(httpUrl("jobs.acme.com/123")).toBe("https://jobs.acme.com/123");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,hi")).toBeNull();
    expect(httpUrl("")).toBeNull();
  });
});

describe("ingestEmail", () => {
  it("creates an application from a confirmation and advances it on later emails", async () => {
    await ingestEmail(mail("1"), base);
    await ingestEmail(mail("2", { date: "2026-10-10T00:00:00.000Z" }), { ...base, category: "oa", role: null });
    await ingestEmail(mail("3", { date: "2026-10-20T00:00:00.000Z" }), { ...base, category: "rejection", role: null });
    const apps = await app();
    const [a] = apps;
    expect(apps).toHaveLength(1);
    expect(a.status).toBe("rejected");
    const events = await q("SELECT status FROM status_events ORDER BY occurred_at, id");
    expect(events.map((e) => (e as { status: string }).status)).toEqual(["applied", "oa", "rejected"]);
  });

  it("keeps different roles at the same company separate", async () => {
    await ingestEmail(mail("1"), base);
    await ingestEmail(mail("2"), { ...base, role: "Data Science Intern" });
    expect(await app()).toHaveLength(2);
  });

  it("matches later emails by company domain when the company name is missing", async () => {
    await ingestEmail(mail("1"), base);
    await ingestEmail(mail("2", { date: "2026-10-05T00:00:00.000Z" }), { ...base, category: "interview", company: null, role: null });
    expect((await app())[0].status).toBe("interview");
  });

  it("deduplicates action items and creates a task when there is a due date", async () => {
    await ingestEmail(mail("1"), base);
    const action = { type: "form" as const, description: "Fill the form", link: "https://acme.com/form", dueAt: "2026-10-12T00:00:00.000Z" };
    await ingestEmail(mail("2"), { ...base, category: "action_required", actionItems: [action] });
    await ingestEmail(mail("3"), { ...base, category: "action_required", actionItems: [action] });
    expect(await q("SELECT COUNT(*)::int n FROM action_items")).toEqual([{ n: 1 }]);
    expect(await q("SELECT COUNT(*)::int n FROM tasks")).toEqual([{ n: 1 }]);
  });
  it("drops non-web action links from emails", async () => {
    await ingestEmail(mail("1"), base);
    const action = { type: "form" as const, description: "Click here", link: "javascript:alert(document.cookie)", dueAt: null };
    await ingestEmail(mail("2"), { ...base, category: "action_required", actionItems: [action] });
    expect(await q("SELECT link FROM action_items")).toEqual([{ link: null }]);
  });

  it("sends low-confidence emails to review without touching applications", async () => {
    const r = await ingestEmail(mail("1"), { ...base, confidence: 0.4 });
    expect(r.needsReview).toBe(true);
    expect(await app()).toHaveLength(0);
  });

  it("skips emails it has already processed", async () => {
    await ingestEmail(mail("1"), base);
    expect((await ingestEmail(mail("1"), base)).skipped).toBe(true);
  });
});

describe("end-to-end with the rules classifier", () => {
  it("builds the expected pipeline from the demo inbox", async () => {
    for (const e of demoEmails()) await ingestEmail(e, classifyHeuristic(e));
    const rows = await q("SELECT company, status FROM applications ORDER BY company");
    expect(rows).toEqual([
      { company: "Datadog", status: "applied" },
      { company: "Google", status: "interview" },
      { company: "Jane Street", status: "rejected" },
      { company: "Netflix", status: "applied" },
      { company: "Stripe", status: "applied" },
    ]);
    const netflix = await q("SELECT x.type, x.link FROM action_items x JOIN applications a ON a.id = x.application_id WHERE a.company = 'Netflix'");
    expect(netflix).toEqual([{ type: "form", link: "https://jobs.netflix.com/candidate-form?id=8812" }]);
  });
});

describe("gmail helpers", () => {
  it("keeps link targets when converting HTML", async () => {
    expect(htmlToText('<p>Please <a href="https://x.com/f">complete this form</a></p>')).toContain("complete this form (https://x.com/f)");
  });
  it("builds union queries including known company domains", async () => {
    const q = buildQueries(1700000000, ["netflix.com"]);
    expect(q.some((x) => x.includes('"thank you for applying"'))).toBe(true);
    expect(q.at(-1)).toContain("from:(netflix.com)");
    expect(q.every((x) => x.includes("after:1700000000"))).toBe(true);
  });
});

describe("review confirmation", () => {
  it("a user-confirmed email creates its application even for generic updates", async () => {
    await ingestEmail(mail("1"), { ...base, category: "update_other", confidence: 0.5 });
    expect(await app()).toHaveLength(0);
    const r = await ingestEmail(mail("1"), { ...base, category: "update_other", confidence: 1 }, { force: true });
    expect(r.needsReview).toBe(false);
    expect(await app()).toHaveLength(1);
  });
});

describe("security helpers", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("shows only known login error messages, never text from the URL", async () => {
    expect(loginErrorMessage("cancelled")).toBe("Google sign-in was cancelled.");
    expect(loginErrorMessage("Your account was hacked, go to evil.example")).toBeNull();
    expect(loginErrorMessage("toString")).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
  });
  it("only allows demo mode (no sign-in) in a local dev server", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DEMO_MODE", "1");
    expect(isDemo()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isDemo()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgres://x");
    expect(isDemo()).toBe(false);
  });
  it("round-trips encrypted tokens and rejects tampering", async () => {
    const box = encrypt('{"refresh_token":"abc"}');
    expect(box).not.toContain("abc");
    expect(decrypt(box)).toBe('{"refresh_token":"abc"}');
    const parts = box.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("signs sessions and rejects forged ones", async () => {
    const { value } = createSessionToken("me@example.com");
    expect(readSessionToken(value)).toBe("me@example.com");
    const forged = Buffer.from(JSON.stringify({ email: "attacker@example.com", exp: Date.now() + 1e9 })).toString("base64url") + "." + value.split(".")[1];
    expect(readSessionToken(forged)).toBeNull();
  });
});
