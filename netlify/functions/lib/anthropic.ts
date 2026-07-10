import Anthropic from '@anthropic-ai/sdk'
import { env, isMockLLM } from './env'
import { searchKnowledge, searchProducts, logGap, type ProductHit } from './retrieval'
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

export type AgentEvents = {
  onToken: (text: string) => void
  onTool: (name: string, status: 'start' | 'end', summary: string) => void
  onProductCard: (card: ProductHit & { fit_note: string }) => void
  onGap: (question: string) => void
  onCitations: (ids: string[]) => void
}

/** Run the agentic chat loop, streaming into the provided callbacks. */
export async function runAgent(opts: {
  system: string
  messages: Anthropic.MessageParam[]
  maxToolRounds?: number
  events: AgentEvents
}): Promise<{ text: string }> {
  if (isMockLLM) return runMockAgent(opts)

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const model = env.ANTHROPIC_MODEL
  if (!model) throw new Error('ANTHROPIC_MODEL env var not set')

  const messages = [...opts.messages]
  let fullText = ''
  const citedIds = new Set<string>()
  const productsSeen = new Map<string, ProductHit>()
  const maxRounds = opts.maxToolRounds ?? 4

  for (let round = 0; round <= maxRounds; round++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 1500,
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
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
          hits.forEach((h) => citedIds.add(h.id))
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

  // parse citations from <cited>...</cited>
  const cited = /<cited>([^<]*)<\/cited>/.exec(fullText)?.[1]
  const ids = cited ? cited.split(',').map((s) => s.trim()).filter(Boolean) : [...citedIds]
  opts.events.onCitations(ids)

  return { text: fullText }
}

function toolSummary(name: string, input: Record<string, string>): string {
  if (name === 'search_knowledge') return `Checking the brain: “${input.query ?? ''}”`
  if (name === 'search_products') return `Checking the catalogue: “${input.query ?? ''}”`
  if (name === 'log_gap') return 'Logging a knowledge gap for Tony'
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
  opts.events.onCitations(hits.map((h) => h.id))
  return { text }
}
