import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createSSE, jsonResponse, startKeepalive } from './lib/sse'
import { requireAdmin, serviceClient } from './lib/auth'
import { env, isMockLLM, isSupabaseConfigured } from './lib/env'
import { teachSystem, teachGapsLayer } from './lib/prompts/teach'
import { distillToCards, queueProposals } from './lib/learning'

type Turn = { role: 'user' | 'assistant'; text: string }

/**
 * Teach mode (admin): gap-driven interview. The client holds the running
 * transcript and sends it whole each turn (stateless server, v1); on
 * {end:true} the transcript is distilled into queue proposals and a
 * teach_sessions row is written.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.failure) return auth.failure

  let body: { turns?: Turn[]; end?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
  const turns = (body.turns ?? []).filter((t) => t.text?.trim())

  // ── session end: distil the whole transcript ──
  if (body.end) {
    const transcript = turns.map((t) => `${t.role === 'assistant' ? 'Brain' : 'Tony'}: ${t.text}`).join('\n')
    try {
      const cards = await distillToCards(transcript, 'teach_session')
      const userId = auth.user.id === '00000000-0000-0000-0000-000000000000' ? null : auth.user.id
      let sessionId: string | null = null
      if (isSupabaseConfigured && userId) {
        const { data } = await serviceClient()
          .from('teach_sessions')
          .insert({ user_id: userId, kind: 'interview', transcript, cards_proposed: cards.length })
          .select('id')
          .single()
        sessionId = data?.id ?? null
      }
      const queued = await queueProposals(cards, 'teach_session', userId, { kind: 'teach_session', teach_session_id: sessionId })
      return jsonResponse(200, { proposals: queued })
    } catch (err) {
      return jsonResponse(500, { error: `Distillation failed: ${String(err)}` })
    }
  }

  // ── interview turn: stream the next question ──
  const gaps = await openGaps()
  const system = [teachSystem(), teachGapsLayer(gaps)].join('\n\n')
  const sse = createSSE()

  void (async () => {
    sse.send('meta', {})
    const stopKeepalive = startKeepalive(sse)
    try {
      if (isMockLLM) {
        const canned =
          turns.length === 0
            ? `G'day Tony — got a few minutes? Staff keep getting asked about servicing intervals on overlockers and the brain's got nothing. How often should a busy workroom actually service one?`
            : `Good stuff. And does that change for the heavier machines — the walking foots doing canvas all day?`
        for (const word of canned.split(/(?<=\s)/)) {
          sse.send('token', { text: word })
          await new Promise((r) => setTimeout(r, 12))
        }
      } else {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
        const model = env.ANTHROPIC_MODEL
        if (!model) throw new Error('ANTHROPIC_MODEL env var not set')
        const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }))
        if (messages.length === 0) messages.push({ role: 'user', content: '(Tony has just opened teach mode — greet him briefly and ask your first question.)' })
        const stream = client.messages.stream({
          model,
          max_tokens: 400,
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
        })
        stream.on('text', (delta) => sse.send('token', { text: delta }))
        await stream.finalMessage()
      }
      sse.send('done', {})
    } catch (err) {
      sse.send('error', { message: String(err) })
    } finally {
      stopKeepalive()
      sse.close()
    }
  })()

  return sse.response
}

async function openGaps(): Promise<{ question: string; times_asked: number }[]> {
  if (!isSupabaseConfigured) {
    return [
      { question: 'Servicing intervals for overlockers in a busy workroom?', times_asked: 3 },
      { question: 'Why would a K6 skip stitches on horse rugs?', times_asked: 2 },
    ]
  }
  const { data } = await serviceClient()
    .from('knowledge_gaps')
    .select('question, times_asked')
    .in('status', ['open', 'queued_for_teach'])
    .order('times_asked', { ascending: false })
    .limit(8)
  return data ?? []
}

export const config: Config = { path: '/api/teach' }
