import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSetting, setSetting } from "./db";
import { allowedEmails, readSessionToken, SESSION_COOKIE } from "./secure";

/**
 * Who may use this instance:
 * - ALLOWED_EMAIL set → only those Google accounts (required in production).
 * - Local dev without ALLOWED_EMAIL → the first account that signs in becomes the owner.
 */
export async function isAllowed(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  const allowed = allowedEmails();
  if (allowed.length) return allowed.includes(e);
  if (process.env.NODE_ENV === "production") return false;
  const owner = await getSetting("owner_email");
  if (!owner) {
    await setSetting("owner_email", e);
    return true;
  }
  return owner === e;
}

/** Demo mode: local-only preview with sample data, never active when a real DATABASE_URL is configured. */
export const isDemo = () => process.env.DEMO_MODE === "1" && !process.env.DATABASE_URL;

export async function currentUser(): Promise<string | null> {
  if (isDemo()) return "demo@example.com";
  const email = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!email) return null;
  const allowed = allowedEmails();
  if (allowed.length) return allowed.includes(email) ? email : null;
  if (process.env.NODE_ENV === "production") return null;
  return (await getSetting("owner_email")) === email ? email : null;
}

/** Call at the top of every data read and server action. */
export async function requireUser(): Promise<string> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
