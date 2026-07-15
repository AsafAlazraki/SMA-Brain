import type { Config } from '@netlify/functions'
import { jsonResponse } from './lib/sse'
import { authenticate } from './lib/auth'
import { env } from './lib/env'

/**
 * Mints a short-lived ElevenLabs conversation token for the browser to open a
 * WebRTC voice session with our agent — so our ElevenLabs API key never leaves
 * the server. The client (RealtimeCall) calls this, then startSession({
 * conversationToken }). Gated behind our own auth; returns 501 until the agent
 * is configured (ELEVENLABS_AGENT_ID), so the app degrades gracefully before
 * setup.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure

  const agentId = process.env.ELEVENLABS_AGENT_ID
  if (!agentId || !env.ELEVENLABS_API_KEY) {
    return jsonResponse(501, { error: 'Voice agent not configured yet' })
  }

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
    })
    if (!res.ok) {
      return jsonResponse(502, { error: `ElevenLabs token ${res.status}: ${(await res.text()).slice(0, 200)}` })
    }
    const data = (await res.json()) as { token?: string }
    if (!data.token) return jsonResponse(502, { error: 'No token returned by ElevenLabs' })
    return jsonResponse(200, { token: data.token })
  } catch (err) {
    return jsonResponse(502, { error: String(err) })
  }
}

export const config: Config = { path: '/api/agent/token' }
