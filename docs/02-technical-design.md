# Tony's Brain — Technical Design (v1)

Companion to `01-prd.md`. This is the how. Voice specifics live in `05-voice-architecture.md`.

## 1. System layout

```
apps (single repo)
├── src/                      React SPA (Vite, TS strict, Tailwind + shadcn/ui, TanStack Router/Query)
│   ├── surfaces/chat         Ask + on-a-call co-pilot UI (streaming, citations, product cards, follow-up chips)
│   ├── surfaces/draft        Email drafter (paste → draft → confidence flags → one-click copy)
│   ├── surfaces/teach        Teach mode (interview + blurt) — admin only
│   ├── surfaces/admin        Approval queue, knowledge browser/editor, gaps, style profile, settings, usage
│   ├── lib/voice             Mic capture, VAD, playback; provider-agnostic (see 05)
│   ├── lib/api               Typed client for /api/* (SSE consumption, retries)
│   └── lib/supabase          Auth session, RLS-scoped reads (conversations, knowledge browse)
├── netlify/functions/        API (TypeScript, one file per endpoint)
│   └── lib/                  anthropic.ts, retrieval.ts, embeddings.ts, prompts/, learning.ts, usage.ts
├── supabase/migrations/      SQL migrations (0001_init.sql is the base schema)
├── scripts/                  ingest-catalog.ts (scraper), seed-knowledge.ts, build-vocab.ts (STT jargon list)
└── docs/                     this pack
```

Two data planes:
- **Client ↔ Supabase (direct, RLS-scoped):** auth, reading own conversations, knowledge browsing, admin CRUD where policies allow. Cheap, realtime-capable, no function invocation.
- **Client ↔ Netlify Functions (SSE/JSON):** anything involving the LLM, embeddings, STT/TTS, learning distillation, or the service-role key. The browser never holds Anthropic/STT/TTS keys.

## 2. API contracts (Netlify Functions)

All endpoints require a Supabase JWT (Authorization: Bearer). Functions verify the JWT, load `profiles.role`, and use the service-role client server-side. SSE endpoints emit named events; every response ends with `done` carrying usage stats.

### POST /api/chat  (SSE)
Req: `{ conversationId?: string, message: string, mode: 'chat'|'call' , voice?: boolean }`
Events:
- `meta {conversationId, messageId}`
- `tool {name, status: 'start'|'end', summary}` — UI shows "checking the catalog…"
- `token {text}` — streamed answer tokens
- `citations {entries: [{id,title}], products: [productCardIds]}`
- `product_card {id, sku, brand, model, name, price_ex_gst, url, image_url, fit_note}`
- `gap {question}` — emitted when the bot logs a knowledge gap
- `done {tokensIn, tokensOut, ms}`

Behaviour: agentic loop with tools `search_knowledge`, `search_products`, `get_product`, `log_gap`. `mode:'call'` switches the system prompt to co-pilot format (one-line answer first, then expandable detail; ≤2 tool rounds; brevity bias) and relaxes nothing on grounding rules.

### POST /api/draft  (SSE)
Req: `{ customerEmail: string, notes?: string }`
Events: `meta {draftId}` · `mined {topics:[...], questions:[...]}` · `token {text}` · `confidence {flags:[{start,end,reason}]}` · `done`.
Behaviour: (1) fast-model pass strips quoted history/signatures, extracts the actual questions, writes `email_drafts.mined_topics`, upserts `knowledge_gaps` for unanswerable asks; (2) big model drafts using retrieval + active `style_profile`; (3) fast-model self-check marks low-confidence spans (facts not grounded in retrieved cards).

### POST /api/draft/finalize
Req: `{ draftId, finalText }` (fired on Copy). Computes diff vs draft; if meaningful and `self_learning_enabled`, runs edit-distillation (fast model) → `learning_queue` proposals (source_type `email_edit`). Returns `{ queued: n }`.

### POST /api/blurt
Req: `{ transcript?: string, audioPath?: string }` (audio already uploaded to Storage from the client). Admin-only. Distills into 0..n proposals (source_type `blurt`), runs conflict detection, returns `{ proposals: n }`. Fire-and-forget UX; notification badge shows queue count.

### POST /api/teach  (SSE)
Req: `{ sessionId?, userTurn: string }` — the interview loop. The bot's questions are generated from open `knowledge_gaps` (status `open|queued_for_teach`, ordered by `times_asked desc`) + coverage heuristics. On session end (`{end: true}`) → distillation over the whole transcript → proposals (source_type `teach_session`), gaps marked `queued_for_teach`→`answered` when approved later.

### POST /api/correct
Req: `{ messageId, correction: string }` — staff flag + Tony's fix. Creates proposal with `supersedes` hint via conflict detection (source_type `correction`).

### Admin: 
- `GET/POST /api/admin/queue` — list pending; approve `{id, edits?}` → insert/update `knowledge_entries` (status approved, embed, version/supersede), mark gaps answered, set `resulting_entry_id`; reject `{id, reason?}`.
- `POST /api/admin/knowledge` — direct CRUD (create=approved immediately, admin-authored).
- `POST /api/admin/reembed` — re-embed all rows (embed-model migration).
- `GET /api/admin/usage` — daily rollups from `usage_events`.
- `POST /api/ingest/catalog` — run scraper (also runnable as scheduled function; writes products + auto product-cards, refreshes STT vocab list).

### Voice: `POST /api/voice/stt`, `POST /api/voice/tts` (v1 request/streaming endpoints) — contracts in `05-voice-architecture.md`, behind `lib/voice` adapters.

## 3. Retrieval design

- **Hybrid RRF** in Postgres (see `0001_init.sql`): FTS (websearch syntax) + pgvector cosine + trigram (products only, catches "LU2810" ≈ "LU-2810"). k=60 RRF constant, top-40 per leg, top-6/8 fused.
- **Query rewrite** (fast model, cached prompt): expands trade shorthand ("walking foot for clears" → canvas/marine context), normalises model numbers, generates the FTS string + embedding text. Skipped in `call` mode when the raw query already contains a model number (regex) — latency win.
- **Embeddings:** `embeddings.ts` adapter. Default: Supabase Edge Function running gte-small (384-d) is NOT used — we standardise on a 768-d hosted model to keep one dimension in schema; final vendor per voice-research-adjacent bake-off (Voyage vs OpenAI text-embedding-3-small@768). Store `embed_model` per row; `/api/admin/reembed` handles migration. (If we change dimensions: new column + reindex, scripted.)
- **Grounding contract:** the model must cite card ids in a `<cited>` block (parsed out before display); uncited factual claims about prices/policies/specs are a test failure in the eval suite.

## 4. Prompt architecture (netlify/functions/lib/prompts/)

Layered system prompt, ordered for Anthropic prompt caching (static → dynamic):
1. `identity.ts` — who the bot is, SMA context digest, tone, AU English, safety rails. (cached)
2. `grounding.ts` — retrieval rules, citation format, "say when you don't know + log gap". (cached)
3. `style.ts` — active style_profile rendered (drafter only). (cached until profile version bumps)
4. `mode.ts` — chat vs call-co-pilot vs teach vs draft behaviour deltas.
5. Dynamic: conversation window (last N turns, summarised beyond), retrieved cards (compact JSON), user message.

Other prompts: `distill.ts` (transcript/diff → atomic cards: title ≤80 chars, content self-contained, tags from controlled vocab, visibility suggestion + WHY), `conflict.ts` (proposal vs top-5 similar approved cards → none|duplicate|contradicts[id]|refines[id]), `mine_email.ts`, `jargon_repair.ts` (STT text + vocab list → corrected), `rewrite_query.ts`, `confidence.ts`.

## 5. Learning pipeline

```
capture (chat correction | draft finalize diff | email mining | teach/blurt distill | staff suggestion)
  → proposal(s) drafted by fast model (structured output)
  → conflict detection vs existing cards (embedding sim > 0.82 → judge with conflict.ts)
  → learning_queue (status pending, conflict_entry_ids populated)
  → Tony reviews in admin queue: approve (optionally edit) | reject | merge
  → on approve: insert knowledge_entries (approved, source, embed) 
                or version-bump: new row, supersedes_id=old, old → archived
  → gaps resolved: matching knowledge_gaps → answered, resolved_by_entry_id set
```
Toggle: `app_settings.self_learning_enabled` gates auto-capture sources (correction/email/mining). Teach + blurt always capture (explicit acts). Every queue action audited (reviewed_by/at); knowledge history = the supersedes chain.

## 6. Frontend design system

- **Aesthetic bar:** "spectacular" per sponsor — clean industrial-workshop feel: high contrast, generous type, denim/steel palette + safety-orange accent (final tokens in Figma-less tokens file `src/theme.ts`), dark mode default in workshop contexts, light in office. No stock-bootstrap look.
- **PWA:** installable, offline shell (app loads; clear "reconnecting" states; no offline answers in v1), manifest + icons, iOS status-bar theming. Voice on iOS installed-PWA is risk-flagged (see 05) — voice CTA can deep-link to Safari tab if needed.
- **Call co-pilot ergonomics:** sticky quick-ask bar, answer-first layout (headline answer ≤2 lines, expand for detail), follow-up chips, product cards with copy-link button, recent-answers rail (tap to re-open what you told the last caller).
- **Drafter ergonomics:** two panes (their email | draft), confidence-flag underlines with hover reasons, Copy button = rich text + plain text to clipboard, "learned ✓" toast after finalize.
- **Blurt:** floating action button on every admin screen + home-screen shortcut; hold-or-tap to record, waveform, done → background processing → badge.
- **Admin queue:** card stack with side-by-side conflict view (proposal vs existing), one-tap approve/edit/reject, keyboard shortcuts (a/e/r), bulk actions.

## 7. Security

- RLS as the boundary (schema enforces staff/admin; anon has zero grants in v1).
- JWT verified in every function; role checked server-side for admin endpoints.
- Secrets only in Netlify env; `check:secrets` script greps built client bundle in CI.
- Customer email content: stored in `email_drafts` for learning; PII never copied into knowledge content (distiller instruction + queue review); retention policy configurable (default keep 12 months, then strip `customer_email_text`).
- Phase 2 public: separate endpoint + anon-scoped RPCs (`visibility='public' and status='approved'` in SQL), IP rate limits, prompt-injection red-team before launch, no admin tools exposed, lead-capture writes to an isolated table.

## 8. Observability & evals

- `usage_events` on every model/STT/TTS call (tokens, est cost, latency ms in meta) → admin usage dashboard (daily rollup, cost by feature).
- Structured function logs (requestId, userId, route, ms, model) — Netlify log drains later if needed.
- **Eval suite (`npm run eval`):** golden set starts with ~50 questions built from the research corpus + catalog (selection logic, needle/thread pairings, policy answers, model-number lookups, jargon STT round-trips). Each case: expected card id(s) retrieved in top-k + answer-contains assertions + must-not-hallucinate checks. Runs in CI against a seeded test db; blocks merge on regression. Grows every time Tony corrects something (correction → eval case generator).

## 9. Open technical decisions (tracked)

1. Embedding vendor + dimension (bake-off at S3; schema pinned 768-d).
2. Voice stack final selection — pending `05-voice-architecture.md` research synthesis (transport findings already in: WebRTC via LiveKit/Daily strongly indicated over raw WebSockets; Krisp-class noise cancellation for workshop noise; iOS AEC traps documented).
3. Netlify Functions streaming duration limits vs a small always-on voice/SSE service (Fly.io/Railway) — decide at S4 (chat SSE works on Netlify streaming functions; voice realtime likely needs the dedicated path per research).
4. Scraper approach: Joomla/VirtueMart HTML scrape vs export from Tony's backend (ask Tony; scraper built either way as fallback).
5. TTS voice persona (pro Aussie voice vs cloned Tony) — sponsor decision, tech supports both.
