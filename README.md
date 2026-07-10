# Tony's Brain

The living knowledge base of Sewing Machines Australia — an AI assistant staff talk to
(by voice) for instant answers and customer-email drafting, trained and tuned by Tony
through an approval-gated learning loop. Internal first; public later.

**Start here:**
1. `CLAUDE.md` — conventions and guardrails for working in this repo
2. `docs/01-prd.md` — what we're building and why
3. `docs/02-technical-design.md` — architecture, API contracts, retrieval, learning pipeline
4. `docs/03-delivery-plan.md` — the session-by-session build plan (find your session, meet its acceptance criteria)
5. `docs/04-risk-register.md` — what can go wrong and what we do about it
6. `docs/05-voice-architecture.md` — the voice stack decision (research-backed)
7. `docs/knowledge/` — research corpus: seed content for the Brain (do not edit; ingestion input)

**Stack:** React/Vite/TS on Netlify · Netlify Functions (SSE) · Supabase (Postgres + pgvector + Auth + RLS) · Anthropic API (two model tiers) · premium voice per docs/05.

**Local setup (verified):**
```bash
# Zero-key demo (mock mode) — no .env needed at all:
npm install
npm run dev                      # http://localhost:8888 — chat streams from the mock brain

# Full local stack (real database + auth):
cp .env.example .env             # then fill the Supabase block from the next step's output
npx supabase start               # local Postgres+Auth via Docker; prints URL + keys → paste into .env
npm run seed                     # loads the research corpus (~29 cards) into the brain
npm run seed:users               # creates the first logins (invite-only, no self-signup):
                                 #   admin tony@sma.local / TonysBrain!2026
                                 #   staff staff@sma.local / SmaStaff!2026  (local-only defaults)
npm run dev                      # restart so the new .env is picked up
```

Windows note: `npm run check:secrets` needs a working `bash` on PATH (WSL or Git Bash).
If `bash` resolves to a stale WSL, run the script through Git Bash directly.

Deploy note (Phase 1 hosted, when we get there): disable **Auth → Sign up** in the hosted
Supabase dashboard — invite-only is enforced by config only on the local stack, and the
0002 trigger would happily provision a `staff` profile for any self-signup left enabled.

**Mock mode:** with no `ANTHROPIC_API_KEY` set, the whole app still runs — chat streams
grounded answers from a built-in mock corpus (tool events, product cards, citations included).
Add `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` to `.env` for the real brain. Local only for now:
no deploys until Asaf says so.

**Taking over as Claude Code?** Start with `docs/00-kickoff-prompt.md`.

Built by Asaf + Claude Code for Tony (Anthony Pascoe), Sewing Machines Australia.
