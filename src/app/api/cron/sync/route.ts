import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runSync } from "@/lib/sync";
import { GmailQuotaError } from "@/lib/gmail";

export const maxDuration = 300;

/** Scheduled sync. Vercel Cron (or any scheduler) calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runSync()) });
  } catch (e) {
    // A rate limit is temporary and progress is saved; the next scheduled run continues.
    const status = e instanceof GmailQuotaError ? 429 : 500;
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
