import type { Config } from '@netlify/functions'
import { authenticate } from './lib/auth'
import { runLearningCycle, runDescriptionMining } from './lib/research'
import { selfLearningEnabled } from './lib/learning'

/**
 * Autonomous learning run. A Netlify BACKGROUND function (the "-background"
 * suffix) — returns 202 immediately and runs up to 15 min, so it isn't bound
 * by the 10s streaming cap the chat path lives under. Results land in
 * learning_queue for Tony to approve (by voice or in Admin); nothing goes
 * live without him.
 *
 * Triggered by an admin (the /api/research/kick endpoint, or the voice tool),
 * or on a schedule if Tony turns one on. Gated by app_settings
 * .self_learning_enabled, so it can't surprise-spend.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure
  if (auth.user.role !== 'admin') return new Response('admin only', { status: 403 })
  if (!(await selfLearningEnabled())) return new Response('self-learning disabled', { status: 202 })

  let maxGaps = 6
  let mode: 'gaps' | 'descriptions' = 'gaps'
  let limit = 40
  try {
    const body = (await req.json()) as { maxGaps?: number; mode?: string; limit?: number }
    if (body.maxGaps && body.maxGaps > 0) maxGaps = Math.min(body.maxGaps, 20)
    if (body.mode === 'descriptions') mode = 'descriptions'
    if (body.limit && body.limit > 0) limit = Math.min(body.limit, 80)
  } catch {
    /* no body — use defaults */
  }

  // fire and forget: the platform keeps the background function alive
  const result =
    mode === 'descriptions'
      ? await runDescriptionMining({ adminId: auth.user.id, limit })
      : await runLearningCycle({ adminId: auth.user.id, maxGaps })
  console.log(`learning run (${mode}):`, JSON.stringify(result))
  return new Response(JSON.stringify(result), { status: 202, headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { path: '/api/research/run' }
