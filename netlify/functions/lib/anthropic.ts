import Anthropic from '@anthropic-ai/sdk'
import { env, isMockLLM } from './env'
import { searchKnowledge, searchProducts, logGap, type ProductHit } from './retrieval'
import { distillToCards, queueProposals } from './learning'
import { listPendingKnowledge, reviewPendingKnowledge, listKnowledgeGaps } from './voice-admin'
import { MOCK_ANSWER_NOTE } from './mock'

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_knowledge',
    description: 'Hybrid search over SMA knowledge cards (facts, recommendations, troubleshooting, policies). Use before answering any factual question.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search query — include model numbers verbatim' } },
      required: ['query'],
    },
  },
  {
    name: 'search_products',
    description: 'Search the SMA product catalog (machines, parts, accessories). Use when the answer involves something SMA sells.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_product_card',
    description: 'Render a product card in the UI for a product found via search_products. Call once per recommended product with a one-line fit_note.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' },
        fit_note: { type: 'string', description: 'One line: why this product fits the need' },
      },
      required: ['product_id', 'fit_note'],
    },
  },
  {
    name: 'log_gap',
    description: "Log a question the brain couldn't answer confidently, so Tony can teach it.",
    input_schema: {
      type: 'object' as const,
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
  },
]

/** Admin-only tools: teach, review the approval queue, and hear open gaps — all by voice. */
const ADMIN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'capture_knowledge',
    description:
      "The caller (Tony/admin) just taught you something worth keeping — a fact, policy, fault fix, or opinion. Pass their teaching verbatim; it gets written up into knowledge cards for the approval queue. Use for real knowledge only, never for questions or chit-chat.",
    input_schema: {
      type: 'object' as const,
      properties: { teaching: { type: 'string', description: "The caller's teaching, verbatim or near-verbatim" } },
      required: ['teaching'],
    },
  },
  {
    name: 'list_pending_knowledge',
    description:
      'List knowledge cards waiting in the approval queue. Use when the admin asks what needs approving / reviewing. Returns id, title, summary per card.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'review_pending_knowledge',
    description:
      'Approve or reject ONE pending queue card by id (from list_pending_knowledge). Only call after the admin has clearly said which card and which way — never approve on your own initiative.',
    input_schema: {
      type: 'object' as const,
      properties: {
        queue_id: { type: 'string' },
        verdict: { type: 'string', enum: ['approved', 'rejected'] },
      },
      required: ['queue_id', 'verdict'],
    },
  },
  {
    name: 'list_knowledge_gaps',
    description: "List recent questions the brain couldn't answer (open knowledge gaps), so the admin can teach the missing pieces.",
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'start_learning_run',
    description:
      "Kick off an autonomous learning run: the brain works through its open knowledge gaps, mines the catalogue and researches what it can, verifies each finding, and fills the approval queue for the admin to review. Use when the admin says something like 'go learn what you don't know', 'go research the gaps', 'go teach yourself'. It runs in the background (a few minutes) — tell them you've started it and the queue will fill up.",
    input_schema: { type: 'object' as const, properties: {} },
  },
]

export type Citation = { id: string; title: string }

export type AgentEvents = {
  onToken: (text: string) => void
  onTool: (name: string, status: 'start' | 'end', summary: string) => void
  onProductCard: (card: ProductHit & { fit_note: string }) => void
  onGap: (question: string) => void
  onCitations: (entries: Citation[]) => void
}

/** Run the agentic chat loop, streaming into the provided callbacks. */
export async function runAgent(opts: {
  system: string
  messages: Anthropic.MessageParam[]
  maxToolRounds?: number
  /** Latency lever: 'low' for on-a-call turns, 'medium' default. Fable 5 at low effort still answers well. */
  effort?: 'low' | 'medium' | 'high'
  /** Admin callers get capture_knowledge (teach → approval queue). Set to the user id. */
  captureAsUser?: string | null
  /** Raw caller JWT — lets admin tools (start_learning_run) trigger background functions as the caller. */
  callerToken?: string | null
  /** 'fast' runs the ANTHROPIC_MODEL_FAST tier — voice turns need snappy over deep (docs/05 latency budget). */
  tier?: 'main' | 'fast'
  /** Round 1 MUST call a tool. Fast models skip retrieval when a question "feels" unanswerable — this makes grounding structural, not advisory. */
  forceToolFirstRound?: boolean
  events: AgentEvents
}): Promise<{ text: string }> {
  if (isMockLLM) return runMockAgent(opts)

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const model = (opts.tier === 'fast' ? env.ANTHROPIC_MODEL_FAST : '') || env.ANTHROPIC_MODEL
  if (!model) throw new Error('ANTHROPIC_MODEL env var not set')
  // effort is an Opus/Fable-tier control; Haiku (fast tier) 400s on it
  const supportsEffort = /fable|opus|sonnet/i.test(model)

  const messages = [...opts.messages]
  let fullText = ''
  const citedTitles = new Map<string, string>()
  const productsSeen = new Map<string, ProductHit>()
  const maxRounds = opts.maxToolRounds ?? 4

  const adminId = opts.captureAsUser ?? null
  const tools = adminId ? [...TOOLS, ...ADMIN_TOOLS] : TOOLS

  for (let round = 0; round <= maxRounds; round++) {
    // last round: no more tools — the model must answer with what it has
    const finalRound = round === maxRounds
    const stream = client.messages.stream({
      model,
      max_tokens: 1500,
      ...(supportsEffort ? { output_config: { effort: opts.effort ?? 'medium' } } : {}),
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      tools,
      ...(finalRound
        ? { tool_choice: { type: 'none' as const } }
        : opts.forceToolFirstRound && round === 0
          ? { tool_choice: { type: 'any' as const } }
          : {}),
      messages,
    })

    stream.on('text', (delta) => {
      fullText += delta
      // strip <cited> blocks from the visible stream (parsed at the end)
      opts.events.onToken(delta)
    })

    const final = await stream.finalMessage()

    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0 || final.stop_reason !== 'tool_use') break

    messages.push({ role: 'assistant', content: final.content })
    const results: Anthropic.ToolResultBlockParam[] = []

    for (const tu of toolUses) {
      const input = tu.input as Record<string, string>
      opts.events.onTool(tu.name, 'start', toolSummary(tu.name, input))
      let resultPayload: unknown
      try {
        if (tu.name === 'search_knowledge') {
          const hits = await searchKnowledge(input.query ?? '')
          hits.forEach((h) => citedTitles.set(h.id, h.title))
          resultPayload = hits.map(({ id, title, content, tags }) => ({ id, title, content, tags }))
        } else if (tu.name === 'search_products') {
          const hits = await searchProducts(input.query ?? '')
          hits.forEach((h) => productsSeen.set(h.id, h))
          resultPayload = hits.map(({ id, sku, brand, model: m, name, category, price_ex_gst, url }) => ({ id, sku, brand, model: m, name, category, price_ex_gst, url }))
        } else if (tu.name === 'get_product_card') {
          const p = productsSeen.get(input.product_id ?? '')
          if (p) opts.events.onProductCard({ ...p, fit_note: input.fit_note ?? '' })
          resultPayload = { rendered: Boolean(p) }
        } else if (tu.name === 'log_gap') {
          await logGap(input.question ?? '')
          opts.events.onGap(input.question ?? '')
          resultPayload = { logged: true }
        } else if (tu.name === 'capture_knowledge' && adminId) {
          const cards = await distillToCards(input.teaching ?? '', 'blurt')
          const queued = await queueProposals(cards, 'blurt', adminId, { kind: 'voice_call' })
          resultPayload = { queued }
        } else if (tu.name === 'list_pending_knowledge' && adminId) {
          resultPayload = await listPendingKnowledge()
        } else if (tu.name === 'review_pending_knowledge' && adminId) {
          resultPayload = await reviewPendingKnowledge(
            input.queue_id ?? '',
            input.verdict === 'rejected' ? 'rejected' : 'approved',
            adminId,
          )
        } else if (tu.name === 'list_knowledge_gaps' && adminId) {
          resultPayload = await listKnowledgeGaps()
        } else if (tu.name === 'start_learning_run' && adminId) {
          resultPayload = await triggerLearningRun(opts.callerToken ?? null)
        } else {
          resultPayload = { error: `unknown tool ${tu.name}` }
        }
      } catch (err) {
        resultPayload = { error: String(err) }
      }
      opts.events.onTool(tu.name, 'end', '')
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(resultPayload) })
    }
    messages.push({ role: 'user', content: results })
  }

  // parse citations from <cited>...</cited>; fall back to everything retrieved
  const cited = /<cited>([^<]*)<\/cited>/.exec(fullText)?.[1]
  const ids = cited ? cited.split(',').map((s) => s.trim()).filter(Boolean) : [...citedTitles.keys()]
  opts.events.onCitations(ids.map((id) => ({ id, title: citedTitles.get(id) ?? id })))

  return { text: fullText }
}

/** Fire the background learning function as the calling admin; returns immediately. */
async function triggerLearningRun(callerToken: string | null): Promise<{ started: boolean; note: string }> {
  const base = process.env.URL || process.env.DEPLOY_URL
  if (!base || !callerToken) return { started: false, note: 'cannot reach the background runner from here' }
  try {
    // background functions return 202 instantly and keep running up to 15 min
    await fetch(`${base}/api/research/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${callerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxGaps: 8 }),
    })
    return { started: true, note: 'learning run started — queue will fill over the next few minutes' }
  } catch {
    return { started: false, note: 'could not start the learning run' }
  }
}

function toolSummary(name: string, input: Record<string, string>): string {
  if (name === 'search_knowledge') return `Checking the brain: “${input.query ?? ''}”`
  if (name === 'search_products') return `Checking the catalogue: “${input.query ?? ''}”`
  if (name === 'log_gap') return 'Logging a knowledge gap for Tony'
  if (name === 'capture_knowledge') return 'Noting that for the approval queue'
  if (name === 'list_pending_knowledge') return 'Fetching the approval queue'
  if (name === 'review_pending_knowledge') return input.verdict === 'rejected' ? 'Rejecting a card' : 'Approving a card'
  if (name === 'list_knowledge_gaps') return 'Fetching open knowledge gaps'
  if (name === 'start_learning_run') return 'Starting an autonomous learning run'
  return name
}

/** Zero-key demo: retrieval really runs (mock corpus), the "LLM" stitches a grounded answer. */
async function runMockAgent(opts: Parameters<typeof runAgent>[0]): Promise<{ text: string }> {
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
  const question = typeof lastUser?.content === 'string' ? lastUser.content : ''

  opts.events.onTool('search_knowledge', 'start', `Checking the brain: “${question.slice(0, 60)}”`)
  const hits = await searchKnowledge(question, 3)
  opts.events.onTool('search_knowledge', 'end', '')

  opts.events.onTool('search_products', 'start', 'Checking the catalogue')
  const products = await searchProducts(question, 2)
  opts.events.onTool('search_products', 'end', '')

  let text: string
  if (hits.length === 0 && products.length === 0) {
    opts.events.onGap(question)
    text = `The brain doesn't have this one yet — I've logged it for Tony to teach. General guidance only: check the machine's manual or ring the workshop on (07) 3298 5320.`
  } else {
    const best = hits[0]
    text = best ? `${best.content}` : `Here's what the catalogue turned up.`
    for (const p of products.slice(0, 1)) {
      opts.events.onProductCard({ ...p, fit_note: `Catalogue match for this job` })
    }
  }
  text += MOCK_ANSWER_NOTE

  // stream word by word for a realistic feel
  for (const word of text.split(/(?<=\s)/)) {
    opts.events.onToken(word)
    await new Promise((r) => setTimeout(r, 12))
  }
  opts.events.onCitations(hits.map((h) => ({ id: h.id, title: h.title })))
  return { text }
}
