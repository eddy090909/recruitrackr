import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authUrl } from "@/lib/gmail";

/** Start Google sign-in. Signing in also grants read-only Gmail access. */
export async function GET(req: NextRequest) {
  const state = randomBytes(16).toString("hex");
  try {
    const res = NextResponse.redirect(await authUrl(state, req.nextUrl.origin));
    res.cookies.set("oauth_state", state, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", maxAge: 600, path: "/" });
    return res;
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : String(e));
    return NextResponse.redirect(new URL(`/login?error=${msg}`, req.url));
  }
}
