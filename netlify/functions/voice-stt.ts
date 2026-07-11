import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { jsonResponse } from './lib/sse'
import { authenticate } from './lib/auth'
import { env, isMockLLM, isVoiceConfigured } from './lib/env'
import { transcribe } from './lib/voice/elevenlabs'
import { jargonSystem } from './lib/prompts/jargon'
import { STT_VOCAB } from './lib/stt-vocab'

/**
 * Spoken audio → text. Scribe transcription + fast-tier jargon repair so
 * "juki ell you twenty eight ten" comes back as "Juki LU-2810".
 * Client posts the raw recording body with its Content-Type (webm/mp4/ogg).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure
  if (!isVoiceConfigured) return jsonResponse(501, { error: 'Voice not configured — set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID' })

  const mimeType = req.headers.get('content-type') ?? 'audio/webm'
  if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
    return jsonResponse(400, { error: 'post the recording as the request body with its audio Content-Type' })
  }
  const audio = await req.arrayBuffer()
  if (audio.byteLength < 200) return jsonResponse(400, { error: 'recording too short' })
  if (audio.byteLength > 25_000_000) return jsonResponse(400, { error: 'recording too large — keep takes under ~20 minutes' })

  try {
    const raw = await transcribe(audio, mimeType)
    const text = await repairJargon(raw)
    return jsonResponse(200, { text, raw })
  } catch (err) {
    return jsonResponse(502, { error: String(err) })
  }
}

/** Only bother the fast model when the transcript could plausibly contain trade jargon. */
const JARGON_HINT =
  /\d|juki|brother|singer|pfaff|adler|siruba|newlong|seiko|highlead|typical|jack\b|zoje|tex\b|overlock|coverstitch|bartack|bobbin|walking foot|needle|thread|\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i

/** Spelled-out numbers ("ell you twenty eight ten") — the classic mangled-model-number tell. */
const SPELLED_NUMBERS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i

/** Model-number-shaped tokens: "LU-2810", "DDL 8700", "135x17", "V138", "Tex 92". */
const MODEL_TOKEN = /\b[a-z]{1,6}[- ]?\d{2,5}[a-z0-9-]*\b|\b\d{2,4}x\d{1,3}\b/gi

const norm = (s: string) => s.replace(/[-\s]/g, '').toLowerCase()
const VOCAB_NORM = new Set(STT_VOCAB.map(norm))

async function repairJargon(raw: string): Promise<string> {
  const trimmed = raw.trim()
  if (!trimmed || isMockLLM) return trimmed
  if (!JARGON_HINT.test(trimmed)) return trimmed // "hello, how are ya" — nothing to repair, save the round-trip
  // Scribe already nailed it: every model-shaped token matches known vocab and
  // nothing is spelled out in words — repair would be a pure latency tax (~1s)
  const modelTokens = trimmed.match(MODEL_TOKEN) ?? []
  const unknown = modelTokens.filter((t) => !VOCAB_NORM.has(norm(t)))
  if (unknown.length === 0 && !SPELLED_NUMBERS.test(trimmed)) return trimmed
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    const model = env.ANTHROPIC_MODEL_FAST || env.ANTHROPIC_MODEL
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(4000, trimmed.length + 500),
      system: [{ type: 'text', text: jargonSystem(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: trimmed }],
    })
    const fixed = response.content.find((b) => b.type === 'text')?.text.trim()
    return fixed || trimmed
  } catch {
    return trimmed // repair is best-effort — raw transcript beats an error
  }
}

export const config: Config = { path: '/api/voice/stt' }
