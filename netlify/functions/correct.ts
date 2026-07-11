import type { Config } from '@netlify/functions'
import { jsonResponse } from './lib/sse'
import { authenticate } from './lib/auth'
import { distillToCards, queueProposals, selfLearningEnabled } from './lib/learning'

/**
 * Corrections: staff flag a wrong answer and say what's right; the fix is
 * distilled into a proposal for Tony's queue. Auto-capture source — gated by
 * the self-learning toggle (app_settings.self_learning_enabled).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure

  if (!(await selfLearningEnabled())) {
    return jsonResponse(200, { proposals: 0, note: 'Self-learning is switched off — correction noted but not queued.' })
  }

  let body: { question?: string; answer?: string; correction?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
  const correction = (body.correction ?? '').trim()
  if (!correction) return jsonResponse(400, { error: 'correction required' })

  const transcript = [
    body.question ? `Staff asked: ${body.question}` : null,
    body.answer ? `The brain answered: ${body.answer}` : null,
    `Correction from ${auth.user.displayName || 'staff'}: ${correction}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const cards = await distillToCards(transcript, 'correction')
    const userId = auth.user.id === '00000000-0000-0000-0000-000000000000' ? null : auth.user.id
    const queued = await queueProposals(cards, 'correction', userId, { kind: 'correction' })
    return jsonResponse(200, { proposals: queued })
  } catch (err) {
    return jsonResponse(500, { error: `Distillation failed: ${String(err)}` })
  }
}

export const config: Config = { path: '/api/correct' }
