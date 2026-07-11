import Anthropic from '@anthropic-ai/sdk'
import { env, isMockLLM, isSupabaseConfigured } from './env'
import { serviceClient } from './auth'
import { distillSystem, distillUser, DISTILL_SCHEMA } from './prompts/distill'

export type ProposedCard = {
  title: string
  content: string
  tags: string[]
  visibility: 'internal' | 'public'
}

export type LearningSource = 'blurt' | 'teach_session' | 'correction'

/**
 * Distil raw transcript into card proposals on the fast tier.
 * Mock mode (no key): paragraph-split heuristic so the zero-key demo works.
 */
export async function distillToCards(transcript: string, context: LearningSource): Promise<ProposedCard[]> {
  const trimmed = transcript.trim()
  if (!trimmed) return []

  if (isMockLLM) {
    return trimmed
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40)
      .slice(0, 6)
      .map((p) => ({
        title: `${p.slice(0, 72)}${p.length > 72 ? '…' : ''}`,
        content: p,
        tags: ['mock-distill'],
        visibility: 'internal' as const,
      }))
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const model = env.ANTHROPIC_MODEL_FAST || env.ANTHROPIC_MODEL
  if (!model) throw new Error('ANTHROPIC_MODEL_FAST env var not set')

  const response = await client.messages.create({
    model,
    max_tokens: 2500,
    system: [{ type: 'text', text: distillSystem(), cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: DISTILL_SCHEMA } },
    messages: [{ role: 'user', content: distillUser(trimmed, context) }],
  })

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{"cards":[]}'
  const parsed = JSON.parse(text) as { cards?: ProposedCard[] }
  return (parsed.cards ?? []).filter((c) => c.title && c.content)
}

/** Insert proposals into the approval queue. Returns how many were queued. */
export async function queueProposals(
  cards: ProposedCard[],
  sourceType: LearningSource,
  createdBy: string | null,
  sourceRef?: Record<string, unknown>,
): Promise<number> {
  if (cards.length === 0) return 0
  if (!isSupabaseConfigured) return cards.length // mock mode: pretend, so the demo flow completes

  const rows = cards.map((c) => ({
    proposed_title: c.title.slice(0, 200),
    proposed_content: c.content,
    proposed_tags: (c.tags ?? []).slice(0, 8),
    proposed_visibility: c.visibility === 'public' ? 'public' : 'internal',
    source_type: sourceType,
    source_ref: sourceRef ?? null,
    created_by: createdBy,
  }))
  const { error } = await serviceClient().from('learning_queue').insert(rows)
  if (error) throw new Error(`learning_queue insert failed: ${error.message}`)
  return rows.length
}

/** Is auto-capture (corrections / email edits / mining) enabled? Blurt & teach ignore this. */
export async function selfLearningEnabled(): Promise<boolean> {
  if (!isSupabaseConfigured) return true
  const { data } = await serviceClient().from('app_settings').select('self_learning_enabled').eq('id', 1).maybeSingle()
  return data?.self_learning_enabled ?? true
}
