import { getSetting, setSetting } from "./db";
import { classify, type RawEmail } from "./classify";
import { closeStaleActions, ingestEmail } from "./ingest";
import { fetchCandidateEmails } from "./gmail";

export interface SyncSummary {
  fetched: number;
  linked: number;
  review: number;
  ignored: number;
  remaining: number;
  classifier: "llm" | "rules" | "none";
}

let running: Promise<SyncSummary> | null = null;

/** Classify (with limited concurrency) then ingest oldest-first so the timeline is built in order. */
export async function processEmails(emails: RawEmail[], concurrency = 4): Promise<Omit<SyncSummary, "remaining">> {
  const summary = { fetched: emails.length, linked: 0, review: 0, ignored: 0, classifier: "none" as SyncSummary["classifier"] };
  const sorted = [...emails].sort((a, b) => a.date.localeCompare(b.date));
  const results: Awaited<ReturnType<typeof classify>>[] = new Array(sorted.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, sorted.length) }, async () => {
      while (next < sorted.length) {
        const i = next++;
        results[i] = await classify(sorted[i]);
      }
    }),
  );
  for (let i = 0; i < sorted.length; i++) {
    const c = results[i];
    summary.classifier = c.source;
    const r = await ingestEmail(sorted[i], c);
    if (c.category === "not_recruiting") summary.ignored++;
    else if (r.needsReview) summary.review++;
    else if (!r.skipped) summary.linked++;
  }
  return summary;
}

/**
 * Pull new recruiting emails and apply them. Processes at most MAX_EMAILS_PER_SYNC per run
 * so it fits in a serverless time limit; the rest are picked up by the next run.
 */
export function runSync(): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    const days = Number(process.env.SYNC_DAYS || 120);
    const limit = Number(process.env.MAX_EMAILS_PER_SYNC || 150);
    const last = await getSetting("last_sync_at");
    // Overlap by a day; already-processed messages are skipped by Gmail ID.
    const since = last ? new Date(Date.parse(last) - 86_400_000) : new Date(Date.now() - days * 86_400_000);
    const started = new Date().toISOString();
    const { emails, remaining } = await fetchCandidateEmails(since.toISOString(), limit);
    const summary: SyncSummary = { ...(await processEmails(emails)), remaining };
    await closeStaleActions();
    // Only move the window forward once everything in it has been processed.
    if (remaining === 0) await setSetting("last_sync_at", started);
    await setSetting("last_sync_ran_at", started);
    await setSetting("last_sync_summary", JSON.stringify(summary));
    return summary;
  })().finally(() => {
    running = null;
  });
  return running;
}
