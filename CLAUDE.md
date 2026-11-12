# Recruitrackr: project guide

Personal recruiting tracker. Syncs Gmail (read-only), classifies recruiting emails with an LLM, and keeps one record per application: status timeline, action items (forms/OAs/scheduling links), tasks, and a review queue for unsure emails. Single owner per deployment.

Read `AGENTS.md` first: this is Next.js 16 with Cache Components enabled, and APIs differ from older versions. Check `node_modules/next/dist/docs/` before using any Next.js API.

## Commands
- `npm run demo && npm run dev:demo`: preview with sample data, no login or Gmail (use this for UI work)
- `npm run dev`: real app (needs `.env.local`, see `.env.example`)
- `npm run reimport -- --yes`: clear email-built data so the next sync re-classifies everything (after classifier changes)
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`: run all four before every commit

## Layout
- `src/lib/db.ts`: DB adapter. Postgres via `DATABASE_URL`, otherwise embedded PGlite in `./data`. Schema lives here (`CREATE TABLE IF NOT EXISTS`, auto-migrates). Use `$1` params, never string-interpolate values.
- `src/lib/classify.ts`: LLM classifier (Zod-validated JSON) plus rules fallback `classifyHeuristic`.
- `src/lib/ingest.ts`: matching (thread → company → sender domain → role), forward-only status rules, action items, tasks. All in one transaction per email.
- `src/lib/gmail.ts`: OAuth, Gmail search queries, message fetching. `src/lib/sync.ts`: batched sync.
- `src/lib/auth.ts`, `src/lib/secure.ts`, `src/proxy.ts`: owner-only session, encrypted tokens, demo mode.
- `src/lib/queries.ts`: all reads. Each one calls `connection()` and `requireUser()`.
- `src/app/actions.ts`: all mutations (server actions). Each one starts with `await requireUser()`.
- UI: `src/app/page.tsx` (home), `src/app/applications/[id]/page.tsx`, `src/app/review/page.tsx`, `src/app/login/page.tsx`, shared bits in `src/components/`, styles in `src/app/globals.css` (Tailwind 4; `.card`, `.btn`, `.btn-primary`, `.input`, `.label`).

## Rules
- Request-time data must render inside `<Suspense>` (Cache Components).
- Never weaken auth: every new read goes through `queries.ts`, and every new mutation starts with `requireUser()`.
- Store only email metadata and a snippet, never full bodies. Gmail scope stays read-only.
- Timestamps are `TIMESTAMPTZ` in the DB and ISO strings in app code (the adapter converts).
- Add or adjust tests in `tests/` for any change to classify/ingest/secure logic.
- Commits: plain messages, no AI co-author or session trailers.

## Status
Done: Gmail sync, classification, matching, timeline, action items, tasks, review queue, owner login, encrypted tokens, cron sync, Vercel config, CI, demo mode.
Next:
1. Deploy: Neon DB, Google OAuth redirect URI for the Vercel domain, env vars (see README).
2. Kanban view of the pipeline.
3. Network matcher: LinkedIn connections CSV, contacts per company.
4. Resume tailor integration (separate service; attach a resume version to an application).
