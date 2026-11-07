/**
 * Load sample emails into a separate local demo database so you can try the UI without Gmail.
 *   npm run demo       → writes data/demo-pglite
 *   npm run dev:demo   → runs the app on it (no sign-in needed, sync disabled)
 */
import fs from "node:fs";
import path from "node:path";
import { createDb, setDb } from "../src/lib/db";
import { classifyHeuristic } from "../src/lib/classify";
import { ingestEmail } from "../src/lib/ingest";
import { demoEmails } from "./demo-emails";

async function main() {
  const dir = path.join(process.cwd(), "data", "demo-pglite");
  fs.rmSync(dir, { recursive: true, force: true });
  setDb(await createDb(dir));

  let linked = 0;
  let review = 0;
  for (const email of demoEmails()) {
    const c = classifyHeuristic(email);
    const r = await ingestEmail(email, c);
    if (r.needsReview) review++;
    else if (!r.skipped) linked++;
    console.log(`${c.category.padEnd(16)} ${String(c.company ?? "?").padEnd(14)} ${email.subject}`);
  }
  console.log(`\nDemo database written to ${dir} (${linked} linked, ${review} to review).`);
  console.log("Run it with:  npm run dev:demo");
}

main();
