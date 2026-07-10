# CLAUDE.md — Tony's Brain

AI assistant for Sewing Machines Australia (SMA): a trainable knowledge base ("the Brain")
that staff talk to — literally, by voice — for answers and customer-email drafting,
grounded in SMA's products, policies and industrial sewing expertise. Internal first
(Tony + staff), public later behind visibility flags.

**Read before building anything:** `docs/01-prd.md` (what & why), `docs/02-technical-design.md`
(how), `docs/03-delivery-plan.md` (which session you're in, acceptance criteria),
`docs/05-voice-architecture.md` (voice stack decision). `docs/knowledge/` holds the research
corpus used as day-1 seed content — do not edit those files; they're ingestion inputs.

## Stack

- **Frontend:** React 18 + Vite + TypeScript (strict) · Tailwind + shadcn/ui · TanStack Router/Query · PWA (installable, mobile-first). Hosted on Netlify.
- **API:** Netlify Functions (TypeScript). SSE streaming for chat/draft. All secrets server-side only — the browser NEVER holds Anthropic/STT/TTS keys.
- **Data:** Supabase — Postgres + pgvector + FTS (hybrid retrieval), Auth (email/password; roles `admin`/`staff` via `profiles.role`), RLS on everything, Storage for teach-session audio.
- **LLM:** Anthropic API. Two tiers via env: `ANTHROPIC_MODEL` (user-facing answers/drafts/teach interviewing) and `ANTHROPIC_MODEL_FAST` (query rewrite, distillation, tagging, jargon repair, email mining). Streaming + tool use + prompt caching everywhere it helps TTFT.
- **Voice:** per `docs/05-voice-architecture.md`. Providers behind `lib/voice/` adapter interfaces — never call STT/TTS vendors directly from feature code.

## Commands

- `npm run dev` — Vite + Netlify Functions locally (`netlify dev`)
- `npm run test` / `npm run test:watch` — Vitest
- `npm run lint` / `npm run typecheck` — must pass before any commit
- `npm run eval` — golden Q&A regression suite against the retrieval+chat pipeline (see delivery plan S3)
- `supabase db diff -f <name>` / `supabase db push` — migrations (never edit applied migrations; add new ones)

## Conventions & guardrails

1. **RLS is the security boundary.** Never ship a feature that relies on client-side filtering. Public visibility (`knowledge_entries.visibility = 'public'`) is enforced in policies/RPCs, not prompts.
2. **Everything the bot asserts must be retrievable.** Chat answers cite `knowledge_entries`/`products` ids; if retrieval returns nothing relevant, the bot says so and logs a `knowledge_gaps` row. No freelancing on prices, policies or specs.
3. **Learning is queue-gated.** Nothing enters `knowledge_entries` as `approved` except via Tony's approval in the admin queue (or explicit admin edit). Auto-capture writes to `learning_queue` only, and only when `app_settings.self_learning_enabled` is true (blurt/teach capture always allowed).
4. **Model IDs come from env**, never hardcoded. Prompt templates live in `netlify/functions/lib/prompts/` — one file per prompt, exported as typed builders, with a comment header explaining purpose and cache strategy.
5. **Latency is a feature.** Chat TTFT budget: retrieval round + first token < 1.5s on typical queries. Use prompt caching for the static system layers; keep retrieval tool results compact (top-6 cards, trimmed).
6. **Mobile is not an afterthought.** Every UI change is verified at 375px width and desktop. Touch targets ≥ 44px. The on-a-call co-pilot flows must work one-handed on a phone.
7. **Trade jargon is load-bearing.** Model numbers ("LU-2810", "DDL-8700"), needle systems ("135x17", "DBx1", "794"), thread sizes ("Tex 92", "V138") must round-trip search, STT vocab lists and UI without mangling. Tests include jargon cases.
8. **Australian English** in all user-facing copy (colour, organise, "G'day" is fine in samples). Prices shown inc/ex GST explicitly labelled.
9. Write tests for: RPCs (hybrid search ranking), RLS policies (staff vs admin vs anon), learning pipeline (edit-diff → proposal), prompt builders (snapshot). UI: smoke tests for the three core flows (ask, draft, approve).
10. Keep PRs/commits scoped to the current delivery-plan session. Update `docs/03-delivery-plan.md` checkboxes as acceptance criteria are met.

## Definition of done (every session)

Typecheck + lint + tests green · acceptance criteria in `docs/03-delivery-plan.md` demonstrably met · no secrets in client bundle (`npm run check:secrets` greps dist) · migrations apply cleanly to a fresh db · README/docs updated if behavior changed.
