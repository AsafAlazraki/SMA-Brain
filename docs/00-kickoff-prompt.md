# Kickoff prompt for Claude Code

Paste everything below the line into Claude Code after opening the project folder.

---

You are taking over the build of **Tony's Brain** — an AI assistant for Sewing Machines Australia (industrial sewing machine dealer, Brisbane). Everything you need is in this repo. The planning is done; your job is execution.

**Orientation — do this first, in order:**
1. Read `CLAUDE.md` — conventions, guardrails, definition of done. These are binding.
2. Read `docs/01-prd.md` (what & why), `docs/02-technical-design.md` (architecture, API contracts, data model), `docs/03-delivery-plan.md` (your session-by-session plan with acceptance criteria), `docs/05-voice-architecture.md` (voice stack — research-backed decisions, don't relitigate them).
3. `docs/knowledge/` is the research corpus that seeds the brain — treat it as read-only ingestion data, never edit it.

**Current state — all verified working (2026-07-10):**
- Scaffold is real and green: `npm install`, `npm run typecheck`, `npm run lint`, `npm test` (5/5), `npm run build`, `npm run check:secrets` all pass.
- `supabase/migrations/0001_init.sql` applies cleanly to a fresh local stack, including the role-grants block; `npm run seed` inserts ~29 corpus cards; the `search_knowledge` / `search_products` hybrid RPCs return sensible results on the FTS leg alone (embeddings are intentionally zero-vector until S3 wires a provider).
- **End-to-end mock mode works with ZERO keys**: `npm run dev` → POST `/api/chat` streams SSE (tool events → product card → tokens) from a mock corpus; the UI (Ask / Draft / Admin shells) consumes it. Mock mode = `MOCK_LLM=true` or simply no `ANTHROPIC_API_KEY`.
- Functions are Netlify v2 style (default export + `config.path`); SSE helpers in `netlify/functions/lib/sse.ts`; the agentic tool loop in `netlify/functions/lib/anthropic.ts` falls back to mock automatically.

**Your first session:**
1. Verify the toolchain on this machine: `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
2. Start the database: `npx supabase start` (needs Docker running), copy the printed API URL + keys into `.env` (template: `.env.example`), then `npm run seed`.
3. `npm run dev` and confirm chat streams at http://localhost:8888 (mock mode is fine; with an `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` in `.env` you get the real brain).
4. Then open `docs/03-delivery-plan.md` and begin **S1 — Auth & roles**. Work strictly to its acceptance criteria; tick the checkboxes as you land things.

**Scope guard: LOCAL ONLY for now.** No Netlify deploys, no hosted Supabase, no vendor signups — everything runs on this machine until Asaf explicitly says "deploy". Build deploy-ready (env-driven config, nothing hardcoded), but do not deploy.

**Standing rules (short version — CLAUDE.md is authoritative):**
- RLS is the security boundary; never rely on client-side filtering.
- The grounding contract is non-negotiable: prices/policies/specs come from retrieval with citations, or the bot says it doesn't know and logs a gap. Never invent them.
- Learning is queue-gated: nothing becomes approved knowledge except through the admin approval flow.
- Model IDs come from env vars only, never hardcoded.
- Keep mock mode working forever — it's the zero-key demo path and the test substrate.
- Migrations are additive; never edit an applied migration.
- Trade jargon must round-trip: tests include "LU-2810"-style cases; keep them passing and add more.
- Australian English in all user-facing copy.

**Footguns already hit and fixed — don't reintroduce them:**
- SQL-language functions referencing not-yet-created tables fail at migration apply (bodies validate at creation). Create functions after their dependencies, or use plpgsql.
- Supabase API roles need explicit table grants — see the final block of `0001_init.sql`; repeat that pattern (or rely on the `alter default privileges` lines) in every future migration.
- The seed script is idempotent via a title-existence check — there's deliberately no unique constraint on titles.

When S1's acceptance criteria are met: run the full check suite, update the delivery-plan checkboxes in the same commit, and end with a 3-line demo note telling Asaf exactly what to click to see it working.
