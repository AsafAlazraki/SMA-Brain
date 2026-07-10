# Tony's Brain — Delivery Plan (session-by-session)

Each session is a scoped Claude Code working session with explicit acceptance criteria.
Sessions assume the docs pack is in the repo. Order matters; a session may span more than
one sitting but never merges without its criteria green. Update the checkboxes as you go.

## Prerequisites (humans, before S0)
- [ ] GitHub repo created (private) — `tonys-brain`
- [ ] Supabase project (region: Sydney `ap-southeast-2`) + keys — **and disable Auth → Sign up
      in the dashboard** (invite-only lives in config.toml locally; hosted needs the toggle)
- [ ] Netlify site linked to repo + env vars set
- [ ] Anthropic API key (SMA-owned billing) — env `ANTHROPIC_API_KEY`, models pinned in env
- [ ] Voice vendor keys (per `05-voice-architecture.md` final rec) — can trail until S8
- [ ] Decision: catalog via scrape or backend export (ask Tony re site platform access)

## S0 — Repo & infrastructure bootstrap
Scaffold Vite React TS app + Tailwind + shadcn/ui + TanStack Router/Query; Netlify config (`netlify.toml`, functions dir, SPA redirects); Vitest + ESLint + typecheck + `check:secrets` CI (GitHub Actions); Supabase CLI wired, `0001_init.sql` applied to hosted project; PWA manifest + icons + service-worker shell.
**Accept when:** `netlify dev` serves app locally with hot reload · CI green on a trivial PR · migration applies to fresh db · deployed preview loads on phone + desktop.

## S1 — Auth & roles
Supabase email/password auth, invite-only user creation (admin seeds accounts); `profiles` row auto-created (trigger); role-aware routing (admin sees admin nav); session handling in SPA; auth guard on all `/api/*` functions (shared middleware).
**Accept when:** Tony(admin) + one staff account log in · staff cannot see admin surfaces or call admin endpoints (tested) · RLS policy tests pass (staff vs admin fixtures).

Progress (2026-07-10):
- [x] Email/password auth in SPA: `src/lib/auth.tsx` provider, `/login` page, session handling, sign-out
- [x] Invite-only: signup disabled in `supabase/config.toml`; accounts via `/api/admin/users` (admin-gated) or `npm run seed:users`
- [x] `profiles` auto-created by trigger with role from `app_metadata` (`0002_auth_profiles.sql`)
- [x] Role-aware routing: Admin tab/route only for admins (`RequireAuth`/`RequireAdmin` guards)
- [x] Shared auth middleware on all `/api/*` functions (`netlify/functions/lib/auth.ts`); mock mode still key-free
- [x] Tests written: middleware units (green) + RLS fixtures & endpoint-guard integration suites
- [ ] **Acceptance run pending local Supabase** — blocked on machine: WSL2 not installed (Docker Desktop
      needs it on Windows Home). After `wsl --install` + reboot: `npx supabase start` → fill `.env` →
      `npm run seed && npm run seed:users` → `npm test` (integration suites un-skip) → login smoke.

## S2 — Ingestion: catalog + seed knowledge
`scripts/ingest-catalog.ts`: scrape sewingmachinesaustralia.com.au (Joomla/VirtueMart; polite rate limits, resumable, idempotent upserts by URL/SKU) → `products`; auto-generate product knowledge cards where description carries advice. `scripts/seed-knowledge.ts`: chunk `docs/knowledge/*.md` into atomic cards (fast model assisted), tag + set visibility (industry generics → public-safe; SMA policies → internal until Tony flips), status `approved`, source `seed`. `scripts/build-vocab.ts`: emit STT vocab JSON (brands/models/systems) from products + curated trade terms.
**Accept when:** ≥90% of site catalog present with name/brand/category/URL (price where listed) · ≥150 seed cards browsable · vocab file generated · re-running scripts is idempotent.

## S3 — Retrieval core + eval harness
`embeddings.ts` adapter + backfill embeddings; hybrid RPCs verified with ranking tests; query-rewrite prompt; `npm run eval` harness with the first ~50 golden cases (built from corpus: selection logic, needle/thread pairing, model-number lookup, policy answers); CI-integrated.
**Accept when:** eval retrieval hit-rate ≥85% top-6 on golden set · "DDL-8700", "ddl 8700", "LU2810" all resolve to right products · eval runs in CI.

## S4 — Ask (chat) + call co-pilot
`/api/chat` SSE with agentic tool loop (search_knowledge, search_products, get_product, log_gap); streaming chat UI with citations, product cards, follow-up chips; `call` mode formatting (answer-first); gap logging + dedupe (normalized_question); feedback buttons (up/down/flag); conversation history.
**Accept when:** 20-question live smoke against seeded brain answers correctly with citations · unanswerable question produces honest "don't know" + gap row · TTFT < 1.5s p50 on preview deploy · usable one-handed at 375px.

## S5 — Draft (email) + learning capture
`/api/draft` (mining pass → styled draft → confidence flags) + drafter UI (two panes, flag underlines, one-click Copy rich+plain); `/api/draft/finalize` diff capture → `email_edit` proposals; `style_profile` v1 seeded from Tony's phrases (interim: from site tone + a few sample replies); email mining → gaps/FAQ candidates.
**Accept when:** paste a real thread → sendable draft with sign-off and correct policies · low-confidence spans visibly flagged · finalize with edits creates queue proposals · mined topics recorded.

## S6 — Learning loop + admin console
Approval queue UI (card stack, conflict side-by-side, one-tap approve/edit/reject, keyboard shortcuts); `/api/correct`; conflict detection pipeline; knowledge browser/editor with version history (supersedes chain); gaps list with "queue for teach"; settings (self-learning toggle); usage dashboard v1.
**Accept when:** end-to-end: staff correction → proposal with conflict shown → Tony approves → card live and next chat answer uses it (demonstrated) · toggle verifiably gates auto-capture · audit fields populated.

## S7 — Teach mode (text) + Blurt (text)
`/api/teach` interview loop driven by open gaps; teach UI (chat-style, admin); distillation on session end → proposals; blurt endpoint + FAB (typed input first; voice lands S8); notification badge for pending queue count.
**Accept when:** a 15-minute mock teach session yields ≥8 sensible atomic proposals · gaps addressed get linked/resolved on approval · blurt-to-proposal round trip < 60s.

## S8 — Voice v1 (the headline)
Per `05-voice-architecture.md` final stack: WebRTC session (mic capture, noise cancellation, turn detection, barge-in), STT with jargon vocab + repair pass, sentence-streamed premium TTS, voice mode UI (push-to-talk + hands-free toggle, live transcript, speaking indicator, interrupt), voice for teach/blurt (long-form dictation path), iOS Safari handling per known traps (gesture-gated start, AudioContext resume, no bare-AudioContext playback).
**Accept when:** voice-to-voice p50 < 1.5s on preview · barge-in works · "juki ell you twenty eight ten" → LU-2810 in transcript · 10-minute blurt transcribes accurately · works on iPhone Safari + Android Chrome + desktop (test matrix documented).

## S9 — Hardening & launch
Eval expansion (+ correction-generated cases); rate limiting; error/empty/reconnect states polish; backup drill (restore migration + data dump); onboarding: 1-page staff guide + 15-min Tony admin walkthrough (written); cost dashboard sanity check; perf pass (bundle, lazy routes); accessibility pass (keyboard, contrast, screen-reader labels on core flows).
**Accept when:** staff onboarded and using it daily for a week · evals green · Tony runs the queue unaided · p95 chat TTFT < 2.5s · zero secrets in bundle (CI proof).

## P2 — Public bot (separate project phase, post-internal-bedding)
Anon-scoped RPCs + separate endpoint + rate limits; public widget on sewingmachinesaustralia.com.au; persona + disclosure; lead capture + handoff; injection red-team; visibility audit with Tony (what's public); go-live checklist.
**Accept when:** red-team findings closed · Tony signs off on public knowledge set · lead emails arriving.

## Standing rules
- Never merge red CI. Never skip the eval suite. Each session ends with a deploy preview link + 3-line demo note to Asaf/Tony.
- New Tony corrections → eval cases (S6 onward this is automated).
- Docs in this pack are living: update alongside code in the same PR when behaviour changes.
