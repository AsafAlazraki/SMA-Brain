# Tony's Brain — Voice Architecture (research-backed)

Status: recommendation drafted from 5 of 8 completed research streams (architecture patterns,
transport/mobile/noise, orchestration platforms, STT comparison, latency budgets + case studies).
TTS naturalness deep-dive, hosting detail and the Google-stack verdict finalize on synthesis.
Every claim below traces to vendor docs or independent benchmarks gathered 2026-07-10; vendor
marketing claims are flagged in the underlying research.

## 1. The architecture: cascaded, not speech-to-speech

The brain must be Claude (Anthropic API = text + tool use; no native audio). That forces a
**cascaded pipeline — streaming STT → Claude (agentic RAG) → streaming TTS** — and the research
says that's the production-preferred shape anyway: practitioners report S2S models (OpenAI
Realtime, Gemini Live) follow instructions and call tools less reliably, produce weaker
transcripts for UI/compliance, and are 3–5× more expensive; well-tuned cascades are currently
*faster* than both major S2S APIs. (Hybrid note: Hume EVI 3 can front a Claude turn with its own
first-beat speech — interesting fallback, not v1.)

## 2. Transport: WebRTC, full stop

WebSocket audio = TCP head-of-line blocking (a lost packet stalls playback ~hundreds of ms),
~10× the bandwidth of Opus (512kbps PCM vs ~32kbps), no jitter buffer, no adaptive bitrate —
acceptable for desktop demos, breaks on phones/cellular. WebRTC gives UDP loss-tolerance,
jitter buffers, congestion control, echo cancellation integration and reconnection. 2026
practitioner consensus: browser voice agents ride WebRTC; WebSockets stay server-to-server.

**Critical trap (documented Chromium bug):** browser echo cancellation doesn't reference audio
played through bare `AudioContext` — a WS-style agent that plays TTS via Web Audio will hear
itself and barge-in on its own voice. WebRTC remote-track playback avoids this class of bug.
iOS Safari additionally: gesture-gated audio start, `interrupted` AudioContext states, mic
re-permission per visit, foreground-only, installed-PWA voice is buggier than Safari-tab —
all handled with documented mitigations in S8; voice CTA can deep-link to Safari if PWA proves flaky.

## 3. Orchestration: LiveKit Agents + LiveKit Cloud (recommended)

| Factor | LiveKit | Pipecat Cloud | Vapi / Retell / ElevenLabs Agents |
|---|---|---|---|
| Claude support | Native Anthropic plugin (streaming + tool use) | Native, deepest (adds prompt caching, extended thinking) | Native or shim; less control |
| **Sydney region** | **Yes (`aus`)** | No (Mumbai nearest) | Unverified |
| Turn detection | Audio-based Turn Detector v1.0 built in | smart-turn v3 (12ms CPU, open source) | Platform-managed |
| Noise cancellation | Krisp NC included free; BVC voice-isolation $0.0012/min | Krisp VIVA 10k min/mo free then $0.0015/min | Varies |
| Infra cost | ~$0.011/min (excl. LLM) | ~$0.010/min | $0.05–0.15/min platform fees |
| Free tier | 1,000 agent-min + 5,000 WebRTC-min/mo | Usage-based, no monthly | Limited |
| Hosting | Cloud hosts the agent worker too (or self-host) | Cloud or self-host | SaaS only |

**Why LiveKit wins for us:** the Sydney region is decisive — US-hosted pipelines add ~150–200ms
RTT to *every* turn for Australian users (measured Azure matrix: SYD↔US-West 147ms, ↔US-East
203ms) and that's the difference between "seamless" and "walkie-talkie". Plus: native Anthropic
plugin, best-benchmarked audio turn detector, Krisp included, React SDK + starter apps, agent
hosting on their cloud (no extra ops), and the internal phase likely fits inside/near the free
tier. Pipecat is the runner-up (finest Anthropic integration — prompt caching support matters
for our TTFT) but no AU region kills it for the latency bar. Managed SaaS (Vapi/Retell) cost
5–10× more per minute for less control. **Architecture consequence:** the voice agent is a small
always-on worker (Python or Node, LiveKit Agents SDK) deployed to LiveKit Cloud — NOT a Netlify
Function. It shares `netlify/functions/lib/` retrieval logic via a thin internal API or direct
Supabase access with service role. Netlify keeps hosting the SPA + non-voice endpoints.

**Hosting verdicts (verified against official limits, 2026-07-10):** Netlify cannot host the
voice server — sync functions cap at 60s, background functions don't stream, edge functions get
50ms CPU; officially "no server side processing… outside of Functions." Supabase Edge Functions
terminate WebSockets but cap at 2s total CPU / 150–400s wall clock — dies mid-call. If we ever
self-host the worker instead of LiveKit Cloud agent hosting: **Fly.io `syd`** is the standout
(only Sydney region among PaaS candidates; always-on 512MB machine ≈ US$4/mo; open WS sessions
block autostop). Runners-up: Railway/Render Singapore (+~92ms RTT). Sydney hosting matters:
Sydney↔US-West is ~160ms RTT of pure network tax per exchange.

## 4. STT: three-way bake-off, jargon-first scoring

Independent accuracy (Artificial Analysis WER v2, batch): AssemblyAI Universal-3 Pro 3.1% >
Speechmatics Enhanced 4.0% > Deepgram Nova-3 5.2%. But our decision axes are Australian accents,
trade jargon recall, workshop noise, agent turn-taking and 10–30-min blurt sessions:

- **Deepgram Nova-3/Flux** — explicit `en-AU`; Keyterm Prompting (100 terms, mid-stream updates);
  Flux = STT with *integrated semantic end-of-turn* (~260ms EOT, EagerEndOfTurn for speculative
  LLM calls); cheapest ($0.0048–0.0077/min); noise-marketed. Best agent ergonomics.
- **AssemblyAI U-3.5 Pro Realtime** — best independent WER; semantic+acoustic EOT; immutable
  transcripts; **Voice Focus** noise add-on; 3-hour sessions (perfect for blurt mode); keyterms
  (1,000 words) included; $0.0075/min. AU-accent performance undocumented — must test.
- **Speechmatics Enhanced** — the only vendor with *documented* Australian-accent coverage
  (Global English) and a `sounds_like` custom dictionary uniquely suited to "Juki"/"LU-2810"/
  "Tex 92" pronunciations; strong WER (4.0%); slower finals (0.7–4s), silence-only endpointing,
  opaque realtime pricing. Accent/jargon insurance option.
- Google Chirp 3: en-AU + phrase biasing + denoiser, but **~5-minute streaming cap per stream**
  breaks blurt mode; mid-pack otherwise. OpenAI realtime STT: no streaming vocab biasing, manual
  endpointing, 2–7× the price, hallucination-on-silence reports — out.

**Bake-off protocol (S8, half a day):** record real staff/Tony audio on the workshop floor —
machines running — reading a 60-line jargon script + natural Q&A. Score: keyword recall on model
numbers (not just WER), EOT latency feel, blurt-mode 15-min reliability. Research prediction:
Deepgram Flux for agent turns + AssemblyAI or Deepgram for blurt dictation; Speechmatics if
accents bite. One vendor for both paths if it wins both.

**Noise handling (counter-intuitive, evidence-backed):** systematic studies show noise-suppression
preprocessing *hurts* modern STT accuracy (models are trained on noisy audio) — but it
demonstrably *helps VAD/turn-detection* (no false barge-ins from a walking-foot machine thumping).
So: Krisp/BVC feeds the turn-detection path; A/B raw-vs-denoised into STT during the bake-off.

## 5. TTS: premium streaming, Tony's ears decide (research complete)

Requirements locked: websocket **streaming text input** (synthesize while Claude is still
generating), TTFB ≤ ~150–300ms, natural Australian-appropriate voice, barge-in-safe
(multi-context/cancellable), optional voice clone. The verified field (2026-07-10):

| Vendor | Latency (TTFA) | Naturalness (blind ELO) | AU voices | LLM-stream input | Clone | ~$/min |
|---|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** | 75ms claimed / 264–288ms measured | mid-table (v3 ranks higher but no realtime WS) | **Deep AU library** (Stuart, Lee, Emma…) + en-AU support | WS + `auto_mode`, char timestamps, **multi-context barge-in (5 ctx)** | PVC, **consent-verified**, Creator+ | ~$0.037 |
| **Cartesia Sonic 3.5** | sub-90ms claimed / 188ms measured (Sonic-3) — fastest | **#3 overall** | Thin catalog (clone route) | **Continuations** purpose-built for token streams, word timestamps | 10s instant; Pro clone weaker consent process | ~$0.028–0.037 |
| **Google Gemini 3.1 Flash TTS** | unpublished | **#2 overall** — beats Eleven v3 & Sonic 3.5 | en-AU **Preview** | Streams (first Gemini TTS that does) | n/a | ~$0.03 |
| OpenAI gpt-4o-mini-tts | no claim / legacy 2.3s measured | mid | none | **No WS text-in, no timestamps** | n/a | ~$0.015 |
| PlayHT | — | — | — | — | — | **dead** (Meta acquired, shut down) |

**Recommendation:** **ElevenLabs Flash v2.5 primary** — the only vendor combining a real
Australian voice library, agent-grade streaming (multi-context WS = clean barge-in), timestamps
for UI highlighting, and consent-verified professional cloning if Tony wants the brain to speak
as him. **Cartesia Sonic 3.5 as the latency/naturalness challenger** wired behind the same
adapter. **Google Gemini 3.1 Flash TTS on the watchlist** — #2 in the world on blind quality and
it streams, but Preview status, preview-grade en-AU, tight quotas and unpublished latency keep it
out of production until GA; include it in the listening test if quota allows. Final call: blind
test — 3–4 voices reading real SMA answers (jargon, prices, Aussie place names), Tony picks.

## 6. The latency budget (target: ≤1.5s voice-to-voice p50, ~1s stretch)

Published budgets converge (~800ms great / ~1,500ms ceiling). Ours, engineered:

| Stage | Budget | How |
|---|---|---|
| Capture→server (WebRTC, Sydney edge) | ~50–80ms | LiveKit `aus` region |
| STT final + end-of-turn | ~250–400ms | Flux integrated EOT or AAI semantic EOT; eager-EOT speculation later |
| Claude TTFT (agentic, cached) | ~500–900ms | **Prompt caching on static layers** (measured −75–85% TTFT on long prompts; Hume runs Claude voice at scale this way), compact retrieval, fast-tier model for `call`-mode voice turns with escalation to big model when needed |
| Tool call (retrieval round) | +0 felt | Masked: cached filler phrase ("checking the catalogue…") + thinking audio; retrieval itself <150ms in-region Postgres |
| Sentence 1 → TTS TTFB | ~100–150ms | Streaming-input TTS, first sentence ships while rest generates |
| Playback start | ~50ms | Jitter buffer |

Honest note from the research: no publicly documented Claude cascade hits sub-1s in production
(DoorDash phone: ~2.5s; Hume: unpublished). Our advantages: Sydney everything, small cached
prompts, retrieval in-region, fast-tier voice turns. 1.2–1.5s p50 is realistic for v1; refine
toward 1s with eager-EOT + speculative generation in v1.1.

## 7. Cost picture (internal phase, ~10 staff, moderate voice use)

LiveKit Cloud free tier likely covers early internal use (1,000 agent-min/mo); beyond: ~$0.011/min
infra + STT ~$0.005–0.0075/min + TTS ~$0.03–0.09/min (vendor-dependent) + Claude tokens (cached).
Ballpark at 2,000 voice-min/mo: **~US$100–250/mo all-in voice**, dominated by TTS choice.
Text-only chat/draft usage rides Netlify+Anthropic only. (Full math in research appendix.)

## 8. Decisions this doc still owes

1. Final TTS vendor table + Google verdict (research synthesis incoming — including whether
   Gemini-TTS is realtime-agent-grade or offline-grade).
2. Agent worker language (Python vs Node LiveKit SDK) — pick at S8 with a spike.
3. Blurt-mode path: same WebRTC session vs simple chunked-upload + batch STT (cheaper, simpler,
   latency-irrelevant for dictation) — likely the latter.
4. Speculative generation (EagerEndOfTurn → cancel/commit) — v1.1 optimization, not v1.
