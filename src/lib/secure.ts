import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets: OAuth tokens are encrypted at rest (AES-256-GCM) and the login
 * session is an HMAC-signed cookie. Both use SESSION_SECRET.
 */

export { SESSION_COOKIE } from "./secure-constants";
const SESSION_DAYS = 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (32+ characters) in production");
  return "dev-only-secret-change-me-dev-only-secret";
}

const key = () => createHash("sha256").update(secret()).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1") throw new Error("Unknown ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function createSessionToken(email: string): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 86_400;
  const body = Buffer.from(JSON.stringify({ email, exp: Date.now() + maxAge * 1000 })).toString("base64url");
  return { value: `${body}.${sign(body)}`, maxAge };
}

export function readSessionToken(value: string | undefined): string | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof email === "string" && exp > Date.now() ? email : null;
  } catch {
    return null;
  }
}

/** Emails allowed to use this instance. Required in production so nobody else can sign in. */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
