import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/gmail";
import { isAllowed } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE } from "@/lib/secure";

const fail = (req: NextRequest, msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return fail(req, "Google sign-in was cancelled.");
  if (!code || !state || state !== req.cookies.get("oauth_state")?.value) return fail(req, "Sign-in failed (state mismatch). Try again.");

  try {
    const { email, save } = await exchangeCode(code, url.origin);
    if (!email || !(await isAllowed(email))) return fail(req, `${email || "This account"} isn't allowed to use this Recruitrackr.`);
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
    return fail(req, e instanceof Error ? e.message : String(e));
  }
}
