import type { Config } from '@netlify/functions'
import { jsonResponse } from './lib/sse'
import { authenticate } from './lib/auth'
import { isVoiceConfigured } from './lib/env'
import { synthesize } from './lib/voice/elevenlabs'

/** Text → spoken audio (mp3). The brain's voice out. */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure
  if (!isVoiceConfigured) return jsonResponse(501, { error: 'Voice not configured — set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID' })

  let body: { text?: string; previous_text?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
  const text = (body.text ?? '').trim().slice(0, 2400)
  if (!text) return jsonResponse(400, { error: 'text required' })

  try {
    const audio = await synthesize(text, (body.previous_text ?? '').trim() || undefined)
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
  } catch (err) {
    return jsonResponse(502, { error: String(err) })
  }
}

export const config: Config = { path: '/api/voice/tts' }
