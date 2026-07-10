import type { Config } from '@netlify/functions'
import { jsonResponse } from './lib/sse'
import { authenticate } from './lib/auth'

/**
 * Learning capture stub (S5 wires the real diff → distillation → learning_queue pipeline).
 * Accepts the finalized text so the client contract is stable from day 1.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure
  try {
    const { draftId, finalText } = (await req.json()) as { draftId?: string; finalText?: string }
    if (!finalText) return jsonResponse(400, { error: 'finalText required' })
    return jsonResponse(200, { queued: 0, draftId: draftId ?? null, note: 'learning capture lands in S5' })
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
}

export const config: Config = { path: '/api/draft-finalize' }
