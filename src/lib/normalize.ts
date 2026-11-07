/** Domains that belong to job-application systems or mail providers, not to the hiring company. */
export const PLATFORM_DOMAINS = [
  "greenhouse.io",
  "greenhouse-mail.io",
  "lever.co",
  "hire.lever.co",
  "myworkday.com",
  "myworkdayjobs.com",
  "workday.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "icims.com",
  "jobvite.com",
  "successfactors.com",
  "taleo.net",
  "oraclecloud.com",
  "brassring.com",
  "avature.net",
  "eightfold.ai",
  "phenom.com",
  "hackerrank.com",
  "hackerrankforwork.com",
  "codesignal.com",
  "hirevue.com",
  "codility.com",
  "karat.io",
  "modernhire.com",
  "pymetrics.ai",
  "harver.com",
  "joinhandshake.com",
  "linkedin.com",
  "indeed.com",
  "calendly.com",
  "goodtime.io",
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
];

const COMPANY_SUFFIXES =
  /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|group|holdings|technologies|technology|careers|career|recruiting|recruitment|talent|acquisition|staffing|jobs|hiring|team|university|campus|the)\b/g;

export function companyKey(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function roleKey(role: string | null | undefined): string {
  if (!role) return "";
  return role
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(summer|fall|spring|winter)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two role names plausibly describe the same posting. */
export function rolesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = roleKey(a);
  const kb = roleKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const ta = new Set(ka.split(" "));
  const tb = new Set(kb.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / Math.max(ta.size, tb.size) >= 0.6;
}

export function emailDomain(sender: string | null | undefined): string {
  if (!sender) return "";
  const m = sender.match(/@([a-z0-9.-]+)/i);
  return m ? m[1].toLowerCase() : "";
}

/** Reduce mail.netflix.com → netflix.com (good enough for company domains). */
export function rootDomain(domain: string): string {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return domain;
  const last2 = parts.slice(-2).join(".");
  if (/^(co|com|ac|org)\.[a-z]{2}$/.test(last2)) return parts.slice(-3).join(".");
  return last2;
}

export function isPlatformDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return PLATFORM_DOMAINS.some((p) => d === p || d.endsWith("." + p));
}

/** Keep only http(s) links. Links come from email text, so anything else (javascript:, data:) is dropped. */
export function httpUrl(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function senderName(sender: string | null | undefined): string {
  if (!sender) return "";
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : "";
}
