import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/gmail";
import { isAllowed } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE } from "@/lib/secure";
import type { LoginError } from "@/lib/login-errors";

const fail = (req: NextRequest, code: LoginError) => NextResponse.redirect(new URL(`/login?error=${code}`, req.url));

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return fail(req, "cancelled");
  if (!code || !state || state !== req.cookies.get("oauth_state")?.value) return fail(req, "state");

  try {
    const { email, save } = await exchangeCode(code, url.origin);
    if (!email || !(await isAllowed(email))) return fail(req, "not_allowed");
    await save();
    const session = createSessionToken(email);
    const res = NextResponse.redirect(new URL("/?connected=1", req.url));
    res.cookies.set(SESSION_COOKIE, session.value, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: session.maxAge,
      path: "/",
    });
    res.cookies.delete("oauth_state");
    return res;
  } catch (e) {
    console.error(`[auth] sign-in failed (${e instanceof Error ? e.name : "unknown error"})`);
    return fail(req, "failed");
  }
}
