# Tony's Brain — Product Spec & Build Plan (v1)

**Project:** SMA — The Brain Project
**Client:** Sewing Machines Australia Pty Ltd (Albany Creek, QLD) — Tony, owner & sponsor
**Builders:** Asaf + Claude (planning) + Claude Code (execution)
**Stack:** Netlify (hosting + functions) · Supabase (Postgres/pgvector, Auth, Storage) · Anthropic API (Fable 5-class Claude models) · native voice (STT/TTS)
**Status:** Spec v1 — full production build, not a POC

---

## 1. What we're building

An AI assistant that *is* Tony's brain: everything he knows about industrial sewing machines, his products, his customers' industries, common faults and fixes, and how he likes things said — captured in a living knowledge base that he personally trains, and that his staff talk to (literally, by voice) to get answers and to draft customer email replies in his voice.

Phase 1 is internal: Tony + staff. Phase 2 exposes a guarded public version of the same brain on the SMA website. The architecture treats Phase 2 as a first-class constraint from day 1 (visibility flags on every piece of knowledge), so going public later is a feature flag, not a rebuild.

Why this wins (from our industry research): the industrial sewing trade is losing its experts — sewing machine mechanics are literally a disappearing profession in Australia (~250 left, median age 57), dealers carry a heavy phone/email support burden ("which machine do I need?", "why is it skipping stitches?"), and no dealer-operated, industrial-grade AI assistant exists anywhere in the world yet. The knowledge is scattered across engineer's manuals, parts books, forums and Tony's head. Capturing it into a queryable, trainable brain is capturing the scarcest asset in the trade.

**The experience bar (sponsor requirement, non-negotiable):** seamless. Staff will use this live while on the phone with customers — answers must be instant, glanceable and right. It must look and feel spectacular, on any device (responsive PWA: desktop at the counter, tablet in the showroom, phone in the workshop). The voice interaction must be so smooth it feels like talking to a person. Friction anywhere kills adoption; the design reviews every flow against "could you do this mid-phone-call?"

## 2. Users & roles

| Role | Who | Can do |
|---|---|---|
| **Admin / Trainer** | Tony (+ Asaf as system admin) | Everything: chat, draft, teach mode, approve/reject learnings, edit knowledge, toggle self-learning, manage users, style settings |
| **Staff** | SMA employees | Chat (text + voice), draft emails, flag wrong answers, suggest knowledge ("Tony should confirm this") |
| **Public** (Phase 2) | Website visitors | Ask questions against public-visibility knowledge only; product recommendations; lead capture; handoff to humans |

Auth: Supabase Auth, email + password (magic-link optional), roles enforced with Postgres row-level security. Staff accounts created by admin — no self-signup.

## 3. Product pillars

### P1 — The Brain (knowledge base)
The heart of the system. Two stores:

- **`products`** — structured catalog: every machine, part and consumable SMA sells (brand, model, category, industry fit, price, specs, description, URL). Seeded by scraping/exporting sewingmachinesaustralia.com.au.
- **`knowledge_entries`** — atomic knowledge cards: a fact, recommendation, procedure, fault/fix, policy or opinion. Each has title, content, tags, **visibility (`internal` | `public`)**, status (`approved` | `draft` | `archived`), provenance (seeded / taught-by-Tony / distilled-from-email-edit / correction), version history, and embeddings for retrieval.

Everything the bot says is grounded in these two stores plus conversation context. Answers cite which knowledge cards they used, so staff can trust-but-verify and Tony can spot bad entries.

### P2 — Ask & Draft
- **Ask:** staff ask anything — "customer wants to sew shade sails, what do we recommend?", "what needle system does the LU-2810 take?", "what's our warranty on second-hand machines?" The bot retrieves from the brain (hybrid search: keyword + semantic — model numbers like "DDL-8700" need exact matching, concepts need semantic) and answers with citations. When it can't answer confidently, it says so — and logs the question as a **knowledge gap**.
- **On-a-call co-pilot:** the primary usage moment is a staff member with a customer on the phone. Design consequences: sub-second retrieval feel, answer-first-then-detail formatting (the one-line answer up top, expandable depth below), big tap targets, instant follow-up chips ("what needle?", "price?", "in stock?"), and **product cards** — when a product is the answer, the response renders a rich card (name, price, one-line fit rationale, link to the live sewingmachinesaustralia.com.au product page) that staff can quote from or send to the customer.
- **Draft:** paste a customer email → the bot drafts a reply grounded in the brain, in Tony's voice per the **style profile** (tone, phrases, sign-off, policies like deposit/freight/warranty wording). The flow is deliberately frictionless: paste → draft appears → tweak if needed → **one-click Copy** (clean plain-text/rich-text, ready for their mail client) → send. Learning happens on **both directions of the paste**: (a) the *incoming customer email* is mined (background, fast model) for what customers actually ask — recurring themes feed the knowledge-gap list and FAQ candidates; (b) the *staff's edits* to the draft are diffed — factual fixes become proposed knowledge cards, stylistic fixes become proposed style-profile updates. Every paste makes the brain smarter.

### P3 — Voice: fully talk to it
Everyone — Tony and staff — can hold a spoken conversation with the brain, hands-free capable (workshop-friendly: greasy hands on a machine, phone propped up).

- **In:** mic button + continuous conversation mode. Audio → speech-to-text API with a **custom vocabulary** seeded from SMA's catalog (Juki, LU-2810, DDL-8700, bartacker, 135x17, Tex 92 …) plus a fast Claude pass that repairs jargon the STT mangles ("juki ell you twenty eight ten" → "Juki LU-2810").
- **Out:** natural text-to-speech playback of answers (toggleable), so a conversation flows without reading.
- **Wispr Flow:** confirmed as a system-wide dictation app (types into any text field; personal-dictionary jargon learning; teams plan) but no developer API. Verdict: great optional *input accelerator* staff can install personally — it will "just work" in our chat box — but the app ships its own native voice pipeline regardless, because (a) not every staff member will have Wispr, (b) the public phase absolutely won't, and (c) "fully talk to it" includes it talking back, which Wispr doesn't do.

### P4 — The self-learning loop (Tony trains it)
"Self-learning" implemented honestly: the model is never blind-retrained; the **brain** learns, gated by Tony. Capture sources:

1. **Teach mode (voice-first), including Blurt mode:** Tony opens a session and just talks. Two flavours: **interview** — the bot asks him questions, prioritised by open knowledge gaps ("Staff were asked twice this week about servicing intervals for overlockers — what's your guidance?"); and **blurt** — a one-tap capture button (big, always reachable, works from his phone) where Tony just says whatever's on his mind ("righto, the K6 hates cheap bonded nylon under Tex 90, tell people to…") and taps done. Either way the system transcribes, distills into clean atomic knowledge cards, and queues them. Blurt must be zero-ceremony: tap, talk, done — processing happens in the background and he gets a "3 cards ready for your approval" notification, not a form to fill in.
2. **Corrections:** anyone flags a wrong/incomplete answer; Tony's correction becomes a proposed card that supersedes the old one.
3. **Email edits:** when staff meaningfully edit a drafted reply before sending, a background pass distills what changed — factual fixes become proposed knowledge cards; stylistic fixes become proposed style-profile updates.
4. **Incoming customer emails:** every customer email pasted into the drafter is mined for recurring questions/themes — feeding the gap list and FAQ candidates (customer PII never becomes knowledge content; only the topics/questions do).
5. **Explicit teaching:** a "teach it something" box available everywhere.

All captured learnings land in the **approval queue** as proposed cards (with detected conflicts against existing cards highlighted). Tony approves, edits or rejects — approve = embedded and live for everyone instantly. The **self-learning switch** controls whether sources 2–4 auto-capture; teach/blurt mode always captures (it's explicit).

### P5 — Admin & training console
Tony's cockpit: approval queue (fast, one-tap approve/edit/reject), knowledge browser/editor with search and version history, knowledge-gap list ("what your brain doesn't know yet"), style profile editor, self-learning toggle, user management, and a usage view (questions asked, answers rated, gaps closed, tokens/cost).

## 4. The learning flywheel

Staff ask → bot answers from the brain → what it can't answer becomes a gap → gaps drive Tony's next voice teach session → his answers become cards → Tony approves → the brain grows → staff get better answers and better email drafts → their edits shrink → the bot asks Tony less and knows more. Over months, Tony's brain becomes SMA's most valuable, transferable asset — and the Phase 2 public bot inherits it for free.

## 5. Architecture

```
┌─ Browser (staff / Tony / later public) ─────────────────────┐
│  React + Vite + Tailwind + shadcn/ui   (SPA on Netlify CDN) │
│  Chat UI · Email drafter · Voice mode · Admin console        │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTPS / SSE streaming
┌──────────────▼──────────────────────────────────────────────┐
│  Netlify Functions (TypeScript)                              │
│  /api/chat          agentic RAG chat, streams tokens (SSE)   │
│  /api/draft         email drafting w/ style profile          │
│  /api/teach         teach-session orchestration & distill    │
│  /api/voice/stt     audio → STT vendor → jargon repair       │
│  /api/voice/tts     text → TTS vendor → audio                │
│  /api/learn         capture corrections / email-edit diffs   │
│  /api/admin/*       queue, knowledge CRUD, settings, users   │
│  /api/ingest        catalog scrape/refresh, doc ingestion    │
└───────┬──────────────────────────────┬──────────────────────┘
        │                              │
┌───────▼────────────┐    ┌────────────▼────────────────────┐
│  Anthropic API     │    │  Supabase                        │
│  Fable 5-class     │    │  Postgres + pgvector + FTS       │
│  (answers, drafts, │    │  Auth (roles via RLS)            │
│   distillation)    │    │  Storage (future: PDFs, audio)   │
│  + small fast tier │    │  Edge Function: embeddings       │
│  (repair, tagging, │    └──────────────────────────────────┘
│   query rewrite)   │         + STT/TTS vendor (voice)
└────────────────────┘
```

Key decisions and why:

- **Agentic RAG, not context-stuffing.** The chat endpoint gives Claude tools — `search_knowledge`, `search_products`, `get_product`, `log_gap` — and lets it decide what to retrieve, refine queries, and combine structured product data with knowledge cards. This handles both "compare the LU-2810 and LU-2810-7" (structured) and "customer sews horse rugs, what setup?" (semantic + reasoning).
- **Hybrid retrieval.** Postgres full-text + trigram for exact model numbers/SKUs, pgvector cosine for concepts, fused with reciprocal-rank fusion. Industrial sewing is model-number-dense; pure vector search would fumble it.
- **Two model tiers.** Big model (Fable 5-class, pinned via env var `ANTHROPIC_MODEL`) for user-facing answers, drafts and teach-session interviewing; small fast tier (`ANTHROPIC_MODEL_FAST`) for query rewriting, STT jargon repair, tagging, distillation drafts and conflict detection. Keeps quality where users see it and cost down where they don't.
- **Streaming everywhere.** SSE token streaming from Netlify Functions so answers feel instant; voice mode buffers sentence-by-sentence into TTS for low-latency spoken replies.
- **Embeddings.** Start with Supabase's built-in embedding model via Edge Function (zero extra vendor); schema stores embedding model + version per row so we can re-embed with a stronger vendor (e.g. Voyage) later without migration pain. Hybrid search reduces embedding-quality sensitivity anyway.
- **Everything server-side.** API keys live in Netlify env vars only. The browser never talks to Anthropic/STT/TTS directly.

## 6. Data model (Supabase)

```
profiles            user_id → role (admin|staff), display_name, prefs
products            sku, brand, model, name, category, industries[],
                    price, specs jsonb, description, url, status,
                    tsv (FTS), embedding
knowledge_entries   id, title, content, tags[], visibility (internal|public),
                    status (draft|approved|archived), source
                    (seed|taught|correction|email_edit|manual),
                    version, supersedes_id, created_by, approved_by,
                    approved_at, tsv, embedding, embed_model
knowledge_gaps      question, normalized_question, times_asked, asked_by[],
                    status (open|queued_for_teach|answered|dismissed),
                    resolved_by_entry_id
conversations       id, user_id, mode (chat|draft|teach), title, created_at
messages            conversation_id, role, content, tool_calls jsonb,
                    cited_entry_ids[], feedback (up|down|flag), created_at
email_drafts        message_id, customer_email_text, draft_text,
                    final_text, edit_distance, learned (bool)
learning_queue      id, proposed_title, proposed_content, proposed_tags[],
                    proposed_visibility, source_type, source_ref,
                    conflict_entry_ids[], status (pending|approved|
                    rejected|merged), reviewed_by, reviewed_at
teach_sessions      id, transcript, audio_ref, gaps_addressed[],
                    cards_proposed, cards_approved
style_profile       versioned singleton: tone rules, sign-off, banned/
                    favoured phrases, example pairs (before→after), policies
settings            self_learning_enabled, voice_out_default, model ids, …
usage_events        user_id, kind, tokens_in/out, cost_estimate, created_at
```

RLS: staff read approved knowledge (internal + public) and own conversations; admin reads/writes all; Phase 2 anon role hits a separate public endpoint that can only ever see `visibility = 'public'` + `status = 'approved'` (enforced in the database, not just the prompt).

## 7. Voice design

**Quality bar (hard requirement from sponsor):** the voice must sound genuinely top-tier — natural, warm, conversational, zero robo-voice. This is a product feature, not a checkbox. Budget and vendor choice follow the quality bar, not the other way round.

- **TTS (the voice out):** premium neural TTS with websocket streaming. Primary candidate **ElevenLabs** (best-in-class naturalness, low-latency flash models, Australian voices available); challengers **Cartesia Sonic** (lowest latency in class) and **OpenAI TTS** (budget fallback). Decision by blind listening test — Tony picks the voice with his own ears from 3–4 shortlisted options reading real SMA answers (machine jargon, prices, Aussie place names).
- **Voice persona option — Tony's actual voice:** ElevenLabs professional voice cloning could make the brain literally speak in Tony's (consented, verified) voice. Charming and on-brand internally; for the public phase we likely switch to a professional Australian brand voice + disclosure. Sponsor decision, flagged in §12.
- **Latency architecture:** answers stream sentence-by-sentence into the TTS websocket as Claude generates — target first audible word < ~1.5s after the user stops speaking. **Barge-in** supported: user can interrupt the bot mid-sentence and it stops talking and listens (essential for it to feel like conversation, not voicemail).
- **STT (the ears):** same quality bar. Deepgram Nova-class streaming or OpenAI realtime transcription — both tested against Australian accents + trade jargon before committing. Keyword/vocabulary boosting fed from the product catalog.
- **Jargon strategy:** STT vocabulary boost list auto-generated nightly from `products` (brands, models, needle systems like "135x17") + curated trade-terms list (bartack, coverstitch, walking foot, Tex/V-sizes …) from our industry research; a fast-Claude repair pass fixes anything the STT still mangles ("juki ell you twenty eight ten" → "Juki LU-2810").
- **Conversation mode:** push-to-talk plus hands-free auto-listen (VAD silence detection, echo cancellation so it doesn't hear itself) — workshop-friendly: greasy hands on a machine, phone propped up.
- **Teach mode is voice-first:** long-form listening, live transcript on screen, bot interjects clarifying questions the way an apprentice would. Sessions saved (audio + transcript) so distillation can be re-run.
- **Wispr Flow:** optional per-staff dictation accelerator (Teams plan exists; no API). Works automatically in any text box of our app. Not a dependency.

## 8. Knowledge seeding & ingestion (day-1 brain)

1. **Catalog scrape** of sewingmachinesaustralia.com.au → `products` (machines by industry category, parts, second-hand stock) + auto-generated product cards.
2. **Industry research corpus** (already compiled in this project): customer-segment → machine → needle/thread matrices, stitch classes, needle systems, thread numbering, fault→cause→fix trees, servicing intervals/economics, brand/distributor map. Ingested as `knowledge_entries` tagged `industry`, visibility `public`-safe by default where generic.
3. **Tony's policies & voice** (week 1 teach sessions): warranty terms, freight/delivery, deposits, trade-in policy, service pricing, turnaround, opening lines/sign-offs, do/don't-say list.
4. **Ongoing:** gaps drive teach sessions; catalog re-scrape on schedule; (later, if Tony agrees) historical sent-email import to bootstrap the style profile properly.

## 9. Security & public-phase guardrails

- Roles + RLS as above; visibility flag enforced at the database layer.
- Public bot (Phase 2): separate endpoint + separate system prompt, `public`-only knowledge, rate limiting by IP, no free-text tool access beyond retrieval, lead capture ("want us to call you?"), human handoff, and a red-team pass before launch (prompt injection, price-extraction, competitor-bait, abuse).
- Secrets server-side only; audit trail on all knowledge changes (who approved what, when, previous versions retained).
- Backups: Supabase PITR / scheduled dumps; knowledge base exportable to Markdown at any time (Tony's brain is portable, never locked in).

## 10. Build phases (production milestones)

| # | Milestone | Contents | Accept when |
|---|---|---|---|
| M0 | Foundations | Repo, CI, Netlify site + functions scaffold, Supabase project, schema migrations, auth + roles, seed admin users | Tony/staff can log in; roles enforced |
| M1 | The Brain, seeded | Catalog scraper + ingestion, research corpus ingested, knowledge browser (read), hybrid search working | Search returns right card/product for 20 test queries |
| M2 | Ask | Agentic RAG chat w/ citations + streaming, gap logging, feedback buttons | Staff answer real questions with it; gaps appear in admin |
| M3 | Draft | Email drafter, style profile v1, draft→final diff capture | Tony rates 8/10 drafts "sendable with light edits" |
| M4 | Learning loop | Approval queue, corrections, email-edit distillation, conflict detection, self-learning toggle, knowledge editor | Tony trains it end-to-end without Asaf's help |
| M5 | Voice | STT + jargon repair + TTS, conversation mode, voice-first teach mode | Tony holds a spoken teach session; cards land in queue |
| M6 | Hardening & launch | Eval set (golden Q&A regression suite), usage/cost dashboard, onboarding docs, backup drill, polish | Staff onboarded; evals green; Tony signs off |
| P2 | Public bot | Public endpoint + widget on SMA site, guardrails, lead capture, red-team | Live on sewingmachinesaustralia.com.au |

Sequencing note: M2 and M3 share the retrieval core; M5 rides on all prior. Each milestone = a Claude Code working session (or few) with its own acceptance test.

## 11. Running costs (ballpark, internal phase)

- Anthropic API: light-to-moderate staff usage ≈ AU$30–150/mo (two-tier model strategy keeps this down; usage dashboard tracks real numbers).
- STT/TTS at the top-quality bar: ElevenLabs Creator/Pro tier ≈ US$22–99/mo + Deepgram usage ≈ US$5–20/mo internal (scales with actual voice minutes; usage dashboard tracks it). Voice clone included in ElevenLabs Creator+.
- Supabase: free tier → Pro US$25/mo when we want PITR backups (recommended at launch).
- Netlify: free tier likely sufficient internally; Pro US$19/mo if build minutes/functions demand it.
- Wispr Flow: optional, per-seat, Tony's call.

## 12. Decisions needed / open items

1. **Accounts & keys:** Anthropic API (whose billing?), Netlify, Supabase, STT/TTS vendor — need accounts + keys before M0. Recommend all under an SMA-owned email with Asaf as collaborator.
2. **Domain:** suggest `brain.sewingmachinesaustralia.com.au` (or similar) CNAME'd to Netlify.
3. **Catalog access:** scrape the site vs. get a product export from Tony's e-commerce backend (cleaner if available — ask Tony what platform the site runs on).
4. **Historical emails:** not needed for v1 (per Asaf), but flag for M3+ — even 200 sent replies would make the style profile dramatically better.
5. **STT/TTS vendor bake-off:** blind listening test with Tony — 3–4 shortlisted premium voices reading real SMA answers; plus STT accuracy test on Aussie accents + jargon.
6. **Voice persona:** professional Australian voice vs. cloned Tony voice (consent + verification required; internal-only vs public use) — sponsor decision.
7. **Live-call listening (future ambition?):** v1's call co-pilot = staff quickly querying the brain mid-call. A deeper version — the bot *listening to the customer call* and suggesting answers in real time — is technically possible but a much bigger (privacy + telephony) build. Confirm whether that's on the roadmap so architecture can leave the door open.
8. **Name the thing:** working title "Tony's Brain" / "SMA Brain" — Tony may want something customer-safe before Phase 2.

---
*Spec v1 · 2026-07-10 · Living document — update as decisions land. Companion doc: SMA industry & company knowledge brief (research corpus), saved alongside this in the project.*
