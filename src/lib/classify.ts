import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { emailDomain, isPlatformDomain, rootDomain, senderName } from "./normalize";

export const CATEGORIES = [
  "confirmation",
  "oa",
  "interview",
  "rejection",
  "offer",
  "action_required",
  "update_other",
  "not_recruiting",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const ACTION_TYPES = ["form", "assessment", "schedule", "documents", "reply", "other"] as const;

export interface RawEmail {
  gmailId: string;
  threadId?: string | null;
  subject: string;
  sender: string;
  date: string; // ISO
  snippet?: string;
  body: string; // plain text, links preserved
}

const nullableString = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null));

export const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  company: nullableString,
  role: nullableString,
  actionItems: z
    .array(
      z.object({
        type: z.enum(ACTION_TYPES).catch("other"),
        description: z.string().min(1),
        link: nullableString,
        dueAt: nullableString,
      }),
    )
    .default([]),
  deadline: nullableString,
  interviewAt: nullableString,
  confidence: z.number().min(0).max(1).catch(0.5),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** Pull the first JSON object out of a model response and validate it. */
export function parseClassification(text: string): Classification {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  const parsed = ClassificationSchema.parse(JSON.parse(candidate.slice(start, end + 1)));
  // Normalize dates to ISO where possible.
  const iso = (v: string | null) => {
    if (!v) return null;
    // Date-only deadlines mean "end of that day" in local time, not UTC midnight.
    const dateOnly = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3], 23, 59).toISOString();
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  };
  return {
    ...parsed,
    deadline: iso(parsed.deadline),
    interviewAt: iso(parsed.interviewAt),
    actionItems: parsed.actionItems.map((a) => ({ ...a, dueAt: iso(a.dueAt) })),
  };
}

const SYSTEM_PROMPT = `You read emails from a student's inbox during internship/job recruiting and extract structured data.

Categories:
- confirmation: the company acknowledges receiving an application ("thank you for applying", "we received your application").
- oa: an online assessment / coding challenge / HireVue / game-based assessment is being sent or requested.
- interview: an interview invitation, scheduling request, or confirmed interview.
- rejection: the candidate is not moving forward.
- offer: an offer of employment/internship.
- action_required: the candidate must do something that is NOT an OA or interview (fill a form, upload documents, confirm interest, complete a profile, answer questions) — e.g. "if you applied, you still need to complete this form before we can review your application".
- update_other: recruiting-related but no status change and no action (e.g. "your application is still under review", event invites for applicants).
- not_recruiting: job alerts, newsletters, "jobs you may like", marketing, networking platforms' digests, anything not about a specific application by this candidate.

Rules:
- An email can have a status category AND actionItems (e.g. an OA invite with a link and a deadline → category "oa" plus an actionItem of type "assessment").
- Any time the candidate must do something, add an actionItem with a short imperative description, the most relevant link (exact URL from the email), and dueAt if a date is stated.
- company = the hiring company (not the ATS vendor like Greenhouse/Workday/HackerRank). role = job title if stated.
- Dates as ISO 8601. Use the email's sent date to resolve relative dates. Unknown → null.
- confidence = how sure you are about category and company (0-1).

Respond with ONLY a JSON object:
{"category": "...", "company": string|null, "role": string|null, "actionItems": [{"type": "form"|"assessment"|"schedule"|"documents"|"reply"|"other", "description": string, "link": string|null, "dueAt": string|null}], "deadline": string|null, "interviewAt": string|null, "confidence": number}`;

export async function classifyWithLLM(email: RawEmail, client?: Anthropic): Promise<Classification> {
  const anthropic = client ?? new Anthropic();
  const model = process.env.CLASSIFIER_MODEL || "claude-haiku-5-5";
  const body = email.body.length > 6000 ? email.body.slice(0, 6000) + "\n[truncated]" : email.body;
  const user = `Sent: ${email.date}\nFrom: ${email.sender}\nSubject: ${email.subject}\n\n${body}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      return parseClassification(text);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Classifier returned invalid JSON: ${String(lastError)}`);
}

/* ------------------------------------------------------------------ */
/* Rule-based fallback: used when no ANTHROPIC_API_KEY is set, and in tests. */

const RX = {
  notRecruiting: /(jobs you may like|job alert|new jobs for you|recommended jobs|unsubscribe from job alerts|weekly digest|is hiring\b.*\bapply now)/i,
  offer: /(pleased to (extend|offer)|offer letter|we('d| would) like to offer|congratulations[^.]{0,80}offer)/i,
  rejection: /(unfortunately|not (to )?(be )?mov(e|ing) forward|other candidates|decided to pursue|not selected|no longer under consideration|regret to inform|will not be proceeding)/i,
  oa: /(online assessment|coding (challenge|assessment)|hackerrank|codesignal|codility|hirevue|technical assessment|complete (the|an|your) assessment|\bOA\b)/i,
  interview: /(interview|schedule (a|your) (call|time)|availability for|superday|phone screen|meet with our team)/i,
  action: /(please (fill|complete|submit|upload|confirm|provide)|still need to|action required|before we (can )?review|complete (this|the|your) (form|profile|questionnaire|application))/i,
  confirmation: /(thank(s| you) for (applying|your application|your interest)|received your application|application (has been )?(received|submitted)|we have received|successfully submitted)/i,
};

function firstUrl(text: string, near?: RegExp): string | null {
  const urls = [...text.matchAll(/https?:\/\/[^\s)>"']+/g)].map((m) => m[0]);
  if (!urls.length) return null;
  if (near) {
    const idx = text.search(near);
    if (idx >= 0) {
      const after = urls.find((u) => text.indexOf(u) >= idx);
      if (after) return after;
    }
  }
  return urls.find((u) => !/unsubscribe|privacy|linkedin\.com\/company/i.test(u)) ?? urls[0];
}

function guessDate(text: string, sentIso: string): string | null {
  const m = text.match(
    /\b(?:by|before|due|deadline[:\s]*|no later than)\s+(?:\w+day,?\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/i,
  );
  if (!m) return null;
  const year = new Date(sentIso).getUTCFullYear();
  const cleaned = m[1].replace(/(st|nd|rd|th)\b/i, "");
  const t = Date.parse(/\d{4}/.test(cleaned) ? cleaned : `${cleaned} ${year}`);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(23, 59, 0, 0); // end of the stated day, local time
  return d.toISOString();
}

function guessCompany(email: RawEmail): string | null {
  const text = `${email.subject}\n${email.body}`;
  const patterns = [
    /thank(?:s| you) for (?:applying|your interest|your application)(?: to| in| at| with)? ([A-Z][\w&.\- ]{1,40}?)(?:[!.,\n]| for | to )/,
    /your application (?:to|with|at) ([A-Z][\w&.\- ]{1,40}?)(?:[!.,\n]| for | has )/,
    /(?:at|join) ([A-Z][\w&.\-]{1,30}(?: [A-Z][\w&.\-]+)?)(?:[!.,\n]| is | team)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  const name = senderName(email.sender)
    .replace(/\b(recruiting|careers|staffing|talent( acquisition)?|university|campus|hiring|team|jobs|no-?reply|via .*)\b/gi, "")
    .replace(/[@|-].*$/, "")
    .trim();
  const domain = emailDomain(email.sender);
  if (name && !/^(greenhouse|workday|lever|hackerrank|codesignal|hirevue)/i.test(name)) return name;
  if (domain && !isPlatformDomain(domain)) {
    const root = rootDomain(domain).split(".")[0];
    return root.charAt(0).toUpperCase() + root.slice(1);
  }
  return null;
}

const ROLE_WORD = /\b(Intern(ship)?|Engineer(ing)?|Analyst|Developer|Scientist|Associate|Researcher|Co-?op|Fellow(ship)?)\b/;

function guessRole(email: RawEmail): string | null {
  const text = `${email.subject}\n${email.body}`;
  // Runs of Capitalized words / years, optionally comma-separated ("Software Engineering Intern, BS, Summer 2027").
  const runs = text.match(/(?:[A-Z][\w&/+().-]*|\d{4})(?:,? (?:[A-Z][\w&/+().-]*|\d{4}))*/g) ?? [];
  const hit = runs.find((r) => ROLE_WORD.test(r) && r.split(" ").length >= 2);
  return hit ? hit.replace(/[,.]+$/, "").trim() : null;
}

function actionSentence(text: string): string | null {
  const s = text.match(/[^.\n]*(?:please (?:fill|complete|submit|upload|confirm|provide)|still need to)[^.\n]*/i)?.[0];
  if (!s) return null;
  return s
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*if you (have )?applied[^,]*,\s*/i, "")
    .replace(/[:\s]+$/, "")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
    .slice(0, 160);
}

export function classifyHeuristic(email: RawEmail): Classification {
  const text = `${email.subject}\n${email.body}`;
  const actionItems: Classification["actionItems"] = [];
  let category: Category = "update_other";
  let confidence = 0.6;

  if (RX.notRecruiting.test(text)) {
    category = "not_recruiting";
    confidence = 0.8;
  } else if (RX.offer.test(text)) {
    category = "offer";
    confidence = 0.8;
  } else if (RX.rejection.test(text)) {
    category = "rejection";
    confidence = 0.85;
  } else if (RX.oa.test(text)) {
    category = "oa";
    confidence = 0.8;
    actionItems.push({ type: "assessment", description: "Complete the online assessment", link: firstUrl(text, RX.oa), dueAt: guessDate(text, email.date) });
  } else if (RX.interview.test(text) && !RX.confirmation.test(text)) {
    category = "interview";
    confidence = 0.75;
    if (/schedule|availability|select a time|book/i.test(text))
      actionItems.push({ type: "schedule", description: "Schedule your interview", link: firstUrl(text, /schedule|availability|select a time|book/i), dueAt: guessDate(text, email.date) });
  } else if (RX.action.test(text)) {
    category = "action_required";
    confidence = 0.75;
    const type = /form|questionnaire/i.test(text) ? "form" : /upload|transcript|document|resume/i.test(text) ? "documents" : "other";
    actionItems.push({ type, description: actionSentence(text) ?? "Complete the requested step", link: firstUrl(text, RX.action), dueAt: guessDate(text, email.date) });
  } else if (RX.confirmation.test(text)) {
    category = "confirmation";
    confidence = 0.85;
  }

  // A confirmation can still contain an extra requirement (the "Netflix" case).
  if (category === "confirmation" && RX.action.test(text)) {
    actionItems.push({ type: /form/i.test(text) ? "form" : "other", description: actionSentence(text) ?? "Complete the requested step", link: firstUrl(text, RX.action), dueAt: guessDate(text, email.date) });
  }

  const company = category === "not_recruiting" ? null : guessCompany(email);
  if (!company && category !== "not_recruiting") confidence = Math.min(confidence, 0.5);

  return {
    category,
    company,
    role: category === "not_recruiting" ? null : guessRole(email),
    actionItems,
    deadline: actionItems.find((a) => a.dueAt)?.dueAt ?? null,
    interviewAt: null,
    confidence,
  };
}

export async function classify(email: RawEmail): Promise<Classification & { source: "llm" | "rules" }> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return { ...(await classifyWithLLM(email)), source: "llm" };
    } catch (e) {
      // Log the error type only: parse errors can quote model output, which is drawn from the email.
      const why = e instanceof Anthropic.APIError ? `API ${e.status ?? "error"}` : e instanceof Error ? e.name : "unknown error";
      console.error(`[classify] LLM failed for ${email.gmailId} (${why}), using rules`);
    }
  }
  return { ...classifyHeuristic(email), source: "rules" };
}
