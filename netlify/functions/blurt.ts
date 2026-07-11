import type { Config } from '@netlify/functions'
import { jsonResponse } from './lib/sse'
import { requireAdmin } from './lib/auth'
import { distillToCards, queueProposals } from './lib/learning'

/**
 * Blurt: Tony brain-dumps (typed now, spoken at voice Stage 1), the fast tier
 * distils it into card proposals, they land in his approval queue. Always
 * allowed (explicit act) — not gated by the self-learning toggle.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.failure) return auth.failure

  let body: { transcript?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
  const transcript = (body.transcript ?? '').trim()
  if (!transcript) return jsonResponse(400, { error: 'transcript required' })
  if (transcript.length > 60_000) return jsonResponse(400, { error: 'transcript too long — split it up' })

  try {
    const cards = await distillToCards(transcript, 'blurt')
    const queued = await queueProposals(cards, 'blurt', auth.user.id === '00000000-0000-0000-0000-000000000000' ? null : auth.user.id, {
      kind: 'blurt',
      chars: transcript.length,
    })
    return jsonResponse(200, { proposals: queued })
  } catch (err) {
    return jsonResponse(500, { error: `Distillation failed: ${String(err)}` })
  }
}

export const config: Config = { path: '/api/blurt' }
