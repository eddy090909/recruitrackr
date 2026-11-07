import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/secure-constants";

/**
 * Optimistic check: no session cookie → send to /login.
 * The real check (signature + allowed email) happens in every data read and server action.
 */
export function proxy(req: NextRequest) {
  const demo = process.env.DEMO_MODE === "1" && !process.env.DATABASE_URL;
  if (!demo && !req.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/auth|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
