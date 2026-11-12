/**
 * Start the synced data over so the next sync re-reads Gmail with the current classifier.
 *   npm run reimport -- --yes
 *
 * Uses the same database as the app (DATABASE_URL, or the local embedded database in ./data;
 * .env.local is loaded if present). Keeps the Gmail connection, applications you added by hand,
 * applications you wrote notes or a job link on, and tasks you added yourself. Everything else
 * built from email (applications, timeline, action items, review queue) is deleted.
 */
import { createDb } from "../src/lib/db";

async function main() {
  if (!process.argv.includes("--yes")) {
    console.log("This deletes everything built from your email and re-imports it on the next sync.");
    console.log("Kept: Gmail connection, hand-added applications, applications with notes or a job link, your own tasks.");
    console.log("Run again with --yes to continue:  npm run reimport -- --yes");
    process.exit(1);
  }
  const db = await createDb();
  const counts = await db.tx(async (t) => {
    const apps = await t.query(
      `DELETE FROM applications a
       WHERE EXISTS (SELECT 1 FROM emails e WHERE e.application_id = a.id)
         AND COALESCE(a.notes, '') = '' AND COALESCE(a.job_url, '') = ''
       RETURNING id`,
    );
    await t.query("DELETE FROM status_events WHERE email_id IS NOT NULL");
    await t.query("DELETE FROM action_items WHERE email_id IS NOT NULL");
    await t.query("DELETE FROM tasks WHERE source = 'auto'");
    const emails = await t.query("DELETE FROM emails RETURNING id");
    await t.query("DELETE FROM settings WHERE key IN ('last_sync_at', 'last_sync_summary', 'sync_backlog', 'sync_backlog_listed_at')");
    return { apps: apps.length, emails: emails.length };
  });
  console.log(`Removed ${counts.apps} applications and ${counts.emails} emails. Press "Sync now" in the app to re-import.`);
  console.log("Large inboxes take a few syncs (each one processes up to MAX_EMAILS_PER_SYNC emails).");
  process.exit(0);
}

main();
