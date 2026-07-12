import Anthropic from '@anthropic-ai/sdk'
import { env, isMockLLM, isSupabaseConfigured } from './env'
import { serviceClient } from './auth'
import { searchKnowledge, searchProducts, type ProductHit } from './retrieval'

/**
 * Autonomous learning — the brain teaching itself, not just from Tony.
 *
 * Three engines, one queue. Every path ends at learning_queue (NEVER
 * auto-approved: guardrail 3 holds — Tony approves, now by voice). Every
 * drafted card is adversarially VERIFIED before it's allowed near the queue,
 * and its provenance (evidence + verdict) rides along in source_ref so Tony
 * reviews with the receipts.
 *
 *   1. resolveGaps()      — re-check open gaps against current knowledge;
 *                           close the ones now covered. Self-maintenance,
 *                           no model calls beyond retrieval.
 *   2. draftFromCatalog() — turn the 26k owned products into teachable cards
 *                           grounded ONLY in catalog facts. No web, no
 *                           hallucination surface.
 *   3. researchWeb()      — go out, find external facts, cite sources.
 *                           Gated on the Anthropic org having web search on;
 *                           degrades gracefully with {available:false}.
 */

export type DraftCard = {
  title: string
  content: string
  tags: string[]
  visibility: 'internal' | 'public'
}

export type QueuedResult = {
  gap: string
  route: 'resolved' | 'catalog' | 'web' | 'needs_tony' | 'web_unavailable' | 'no_result'
  queued: number
  detail?: string
}

function client(): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

/** Tolerate a truncated/for-safety-wrapped structured response — never throw mid-cycle. */
function safeParse<T>(text: string): T | null {
  const t = text.trim()
  if (!t) return null
  try {
    return JSON.parse(t) as T
  } catch {
    const m = /\{[\s\S]*\}/.exec(t)
    if (m) {
      try {
        return JSON.parse(m[0]) as T
      } catch {
        return null
      }
    }
    return null
  }
}
const MAIN = () => env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const FAST = () => env.ANTHROPIC_MODEL_FAST || env.ANTHROPIC_MODEL || 'claude-haiku-4-5'

const CARD_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['title', 'content', 'tags', 'visibility'],
        properties: {
          title: { type: 'string' as const, maxLength: 90 },
          content: { type: 'string' as const },
          tags: { type: 'array' as const, items: { type: 'string' as const } },
          visibility: { type: 'string' as const, enum: ['internal', 'public'] },
        },
      },
    },
  },
}

// ─── Engine 1: gap self-resolution ────────────────────────────────────────

/**
 * Re-run retrieval on every open gap; a gap that now has a strong knowledge
 * hit is answered — flip it closed. Returns the gaps still genuinely open.
 */
export async function resolveGaps(): Promise<{ resolved: number; open: { id: string; question: string }[] }> {
  if (!isSupabaseConfigured) return { resolved: 0, open: [] }
  const db = serviceClient()
  const { data } = await db.from('knowledge_gaps').select('id, question').eq('status', 'open').limit(50)
  const gaps = data ?? []
  const stillOpen: { id: string; question: string }[] = []
  let resolved = 0
  for (const g of gaps) {
    const hits = await searchKnowledge(g.question as string, 3)
    // a genuinely-covering hit: decent score and not a trivially-short card
    const covered = hits.some((h) => h.score >= 0.5 && h.content.length > 120)
    if (covered) {
      await db.from('knowledge_gaps').update({ status: 'answered' }).eq('id', g.id)
      resolved++
    } else {
      stillOpen.push({ id: g.id as string, question: g.question as string })
    }
  }
  return { resolved, open: stillOpen }
}

// ─── Engine 2: catalog mining (owned data, no web) ────────────────────────

/**
 * Draft a card that answers a product-shaped gap using ONLY real catalog rows.
 * Grounded in owned data → the verify step checks the card claims nothing the
 * product rows don't support.
 */
async function draftFromCatalog(gap: string): Promise<{ cards: DraftCard[]; products: ProductHit[] }> {
  const products = await searchProducts(gap, 8)
  if (products.length === 0 || isMockLLM) return { cards: [], products }
  const catalogue = products
    .map((p) => `- ${p.brand ?? ''} ${p.model ?? ''} — ${p.name} [${p.category ?? ''}]${p.price_ex_gst ? ` $${p.price_ex_gst} ex GST` : ''}${p.url ? ` (${p.url})` : ''}`)
    .join('\n')
  const res = await client().messages.create({
    model: MAIN(),
    max_tokens: 1500,
    system: [
      {
        type: 'text' as const,
        text: [
          `You write knowledge cards for Sewing Machines Australia (SMA) staff, grounding a recommendation in SMA's ACTUAL catalogue rows (given below).`,
          `HARD RULE: only name products that appear in the catalogue list. Never invent a model, price or spec. If the rows don't actually suit the question, return an empty cards array — a wrong recommendation is worse than none.`,
          `You MAY add generic, uncontroversial trade guidance (needle system, thread size for the job) but keep SMA-specific claims (which machine we sell, price) strictly to the rows.`,
          `Australian English. Card content 1-4 sentences. Titles ≤ 90 chars, searchable. Tags 2-5 kebab-case. visibility "internal" (product recommendations).`,
        ].join('\n'),
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    output_config: { format: { type: 'json_schema' as const, schema: CARD_SCHEMA } },
    messages: [{ role: 'user', content: `Staff gap to answer:\n"${gap}"\n\nSMA catalogue rows that matched this query:\n${catalogue}` }],
  })
  const text = res.content.find((b) => b.type === 'text')?.text ?? ''
  const parsed = safeParse<{ cards?: DraftCard[] }>(text)
  return { cards: (parsed?.cards ?? []).filter((c) => c.title && c.content), products }
}

// ─── Engine 3: web research (gated on org web-search access) ───────────────

const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 4 } as unknown as Anthropic.Tool

/** True until proven false — flips off for the process once a call reports the tool disabled. */
let webSearchAvailable = true

/**
 * Research an external question with web search, returning findings + the
 * source URLs cited. If the org doesn't have web search enabled the tool
 * errors ("server tool use limit exceeded") — we detect that and report
 * unavailable rather than letting the model answer uncited.
 */
async function researchWeb(gap: string): Promise<{ available: boolean; findings: string; sources: string[] }> {
  if (!webSearchAvailable || isMockLLM) return { available: webSearchAvailable, findings: '', sources: [] }
  try {
    const res = await client().messages.create(
      {
        model: MAIN(),
        max_tokens: 1200,
        tools: [WEB_SEARCH_TOOL],
        system: [
          {
            type: 'text' as const,
            text: [
              `You research industrial sewing facts for an Australian dealer (Sewing Machines Australia). Use web search; rely on authoritative sources (manufacturer manuals, reputable trade suppliers).`,
              `Report ONLY facts you found and can cite. Prefer specifics: needle systems (135x17), sizes, thread sizes (Tex/V), timing, settings. If you can't find solid sourced facts, say so plainly — never fabricate.`,
              `Do NOT state SMA-specific prices or policies (you can't source those). End with "SOURCES:" then the URLs.`,
            ].join('\n'),
          },
        ],
        messages: [{ role: 'user', content: gap }],
      },
      // fail fast: don't let an erroring/absent web-search tool hang the whole
      // learning cycle behind SDK retry backoff (the org may not have it on)
      { timeout: 30_000, maxRetries: 0 },
    )
    const errored = res.content.some(
      (b) => (b as { type: string }).type === 'web_search_tool_result' && ((b as { content?: { type?: string } }).content as { type?: string })?.type === 'web_search_tool_result_error',
    )
    const searchCount = (res.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0
    const textBlocks = res.content.filter((b) => b.type === 'text') as { text: string; citations?: { url?: string }[] }[]
    const findings = textBlocks.map((b) => b.text).join('')
    const cited = textBlocks.flatMap((b) => (b.citations ?? []).map((c) => c.url).filter((u): u is string => Boolean(u)))
    const listed = [...findings.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0])
    const sources = [...new Set([...cited, ...listed])]
    // tool present but every search errored, or the model itself flags the limit → mark unavailable
    if ((errored && sources.length === 0) || (searchCount > 0 && sources.length === 0 && /limit exceeded|unavailable|couldn't (search|access)/i.test(findings))) {
      webSearchAvailable = false
      return { available: false, findings: '', sources: [] }
    }
    return { available: true, findings, sources }
  } catch (err) {
    // 400 on the tool type = org can't use it; timeout/abort = don't keep hanging
    if (/web_search|server tool|tool.*not|invalid_request|timeout|aborted|ETIMEDOUT/i.test(String(err))) webSearchAvailable = false
    return { available: webSearchAvailable, findings: '', sources: [] }
  }
}

/** Turn sourced web findings into cards (structured, fast tier). */
async function draftFromFindings(gap: string, findings: string, sources: string[]): Promise<DraftCard[]> {
  if (!findings.trim() || isMockLLM) return []
  const res = await client().messages.create({
    model: FAST(),
    max_tokens: 1500,
    system: [
      {
        type: 'text' as const,
        text: [
          `Turn researched findings into atomic knowledge cards for Sewing Machines Australia staff. Keep every technical specific (needle systems, sizes, thread) exactly. Never add facts not in the findings.`,
          `Australian English, 1-4 sentences per card. Titles ≤ 90 chars. Tags 2-5 kebab-case. visibility "public" for generic trade knowledge, "internal" otherwise.`,
        ].join('\n'),
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    output_config: { format: { type: 'json_schema' as const, schema: CARD_SCHEMA } },
    messages: [{ role: 'user', content: `Gap:\n"${gap}"\n\nResearched findings:\n${findings}\n\nSources:\n${sources.join('\n')}` }],
  })
  const text = res.content.find((b) => b.type === 'text')?.text ?? ''
  return safeParse<{ cards?: DraftCard[] }>(text)?.cards?.filter((c) => c.title && c.content) ?? []
}

// ─── The checker: adversarial verification before anything is queued ──────

/**
 * An independent pass that tries to FAULT the card against its evidence.
 * Only cards it clears are allowed into the queue. This is the automated half
 * of "checking all of that" — Tony's approval is the human half.
 */
async function verifyCard(card: DraftCard, evidence: string): Promise<{ pass: boolean; note: string }> {
  if (isMockLLM) return { pass: true, note: 'mock' }
  const VERDICT = {
    type: 'object' as const,
    additionalProperties: false,
    required: ['supported', 'note'],
    properties: {
      supported: { type: 'boolean' as const, description: 'true ONLY if every claim in the card is supported by the evidence' },
      note: { type: 'string' as const, maxLength: 200, description: 'one short sentence' },
    },
  }
  const res = await client().messages.create({
    model: MAIN(),
    max_tokens: 800,
    system: [
      {
        type: 'text' as const,
        text: `You are a skeptical fact-checker for an industrial sewing knowledge base. Given a proposed card and the ONLY evidence it may rely on, decide if EVERY factual claim is supported by that evidence. Be adversarial: unsupported model numbers, prices, specs, or invented products fail. Default to supported=false if unsure. Safe generic trade knowledge (a standard needle system for a fabric) may pass even if not verbatim in evidence, but SMA-specific claims (which machine we sell, prices) must be in the evidence. Keep "note" to ONE short sentence.`,
      },
    ],
    output_config: { format: { type: 'json_schema' as const, schema: VERDICT } },
    messages: [{ role: 'user', content: `PROPOSED CARD:\n${card.title}\n${card.content}\n\nEVIDENCE (the only thing it may rely on):\n${evidence}` }],
  })
  const text = res.content.find((b) => b.type === 'text')?.text ?? ''
  const v = safeParse<{ supported?: boolean; note?: string }>(text)
  // parse failure ⇒ fail closed (never queue an unverified card)
  return { pass: v?.supported === true, note: v?.note ?? (v ? '' : 'verifier response unparseable — failed closed') }
}

// ─── Queue writer with provenance ─────────────────────────────────────────

async function queueCards(
  cards: DraftCard[],
  sourceType: 'catalog_mining' | 'autonomous_research',
  sourceRef: Record<string, unknown>,
  createdBy: string | null,
): Promise<number> {
  if (cards.length === 0 || !isSupabaseConfigured) return cards.length
  const rows = cards.map((c) => ({
    proposed_title: c.title.slice(0, 200),
    proposed_content: c.content,
    proposed_tags: (c.tags ?? []).slice(0, 8),
    proposed_visibility: c.visibility === 'public' ? 'public' : 'internal',
    source_type: sourceType,
    source_ref: sourceRef,
    created_by: createdBy,
  }))
  const { error } = await serviceClient().from('learning_queue').insert(rows)
  if (error) throw new Error(`queue insert failed: ${error.message}`)
  return rows.length
}

/**
 * A gap with a pending card shouldn't be re-drafted every run — park it as
 * queued_for_teach until Tony's verdict. If he approves, the card covers it;
 * if he rejects, he can re-open it. Prevents duplicate churn.
 */
async function parkGap(gapId: string): Promise<void> {
  if (!isSupabaseConfigured) return
  await serviceClient().from('knowledge_gaps').update({ status: 'queued_for_teach' }).eq('id', gapId)
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

/** Is a gap answerable from external facts, or is it SMA-internal (needs Tony)? */
function isInternalOnly(gap: string): boolean {
  return /\b(our|sma'?s|we charge|our price|our polic|service (price|cost|rate|fee)|repair (price|cost|rate|fee)|warranty period|our warranty|freight|delivery (cost|price)|discount)\b/i.test(gap)
}

/**
 * Process the open gaps end to end: resolve what's already covered, then for
 * each still-open gap pick the right engine, draft, VERIFY, and queue.
 * Bounded by maxGaps so a run can't surprise-spend.
 */
export async function runLearningCycle(opts: { adminId: string | null; maxGaps?: number }): Promise<{
  resolved: number
  results: QueuedResult[]
  webSearch: 'used' | 'unavailable' | 'not_needed'
  totalQueued: number
}> {
  const { resolved, open } = await resolveGaps()
  const gaps = open.slice(0, opts.maxGaps ?? 6)
  const results: QueuedResult[] = []
  let webUsed = false
  let webTried = false

  for (const g of gaps) {
    // 1) product-shaped? mine the catalogue first (owned data, safest)
    const looksProduct = /\b(machine|which .*(model|machine)|recommend|thread|needle|foot|motor|table|servo|buy|sell|stock|price)\b/i.test(g.question)
    if (looksProduct) {
      const { cards, products } = await draftFromCatalog(g.question)
      if (cards.length && products.length) {
        const evidence = products.map((p) => `${p.brand} ${p.model} ${p.name} [${p.category}]${p.price_ex_gst ? ` $${p.price_ex_gst}` : ''}`).join('\n')
        const checked: DraftCard[] = []
        for (const c of cards) {
          const v = await verifyCard(c, evidence)
          if (v.pass) checked.push(c)
        }
        if (checked.length) {
          const n = await queueCards(checked, 'catalog_mining', { gap: g.question, gap_id: g.id, product_ids: products.map((p) => p.id), verified: true }, opts.adminId)
          await parkGap(g.id)
          results.push({ gap: g.question, route: 'catalog', queued: n })
          continue
        }
      }
    }

    // 2) SMA-internal facts can't be researched — flag for Tony
    if (isInternalOnly(g.question)) {
      results.push({ gap: g.question, route: 'needs_tony', queued: 0, detail: 'SMA-internal (price/policy) — only Tony can answer' })
      continue
    }

    // 3) external knowledge → web research + verify against sources
    webTried = true
    const web = await researchWeb(g.question)
    if (!web.available) {
      results.push({ gap: g.question, route: 'web_unavailable', queued: 0, detail: 'web search not enabled on this Anthropic org' })
      continue
    }
    webUsed = true
    if (!web.findings.trim() || web.sources.length === 0) {
      results.push({ gap: g.question, route: 'no_result', queued: 0 })
      continue
    }
    const cards = await draftFromFindings(g.question, web.findings, web.sources)
    const evidence = `${web.findings}\n\nSOURCES:\n${web.sources.join('\n')}`
    const checked: DraftCard[] = []
    for (const c of cards) {
      const v = await verifyCard(c, evidence)
      if (v.pass) checked.push(c)
    }
    const n = await queueCards(checked, 'autonomous_research', { gap: g.question, gap_id: g.id, sources: web.sources, verified: true }, opts.adminId)
    if (n) await parkGap(g.id)
    results.push({ gap: g.question, route: n ? 'web' : 'no_result', queued: n, detail: web.sources.slice(0, 3).join(', ') })
  }

  return {
    resolved,
    results,
    totalQueued: results.reduce((s, r) => s + r.queued, 0),
    webSearch: webUsed ? 'used' : webTried ? 'unavailable' : 'not_needed',
  }
}
