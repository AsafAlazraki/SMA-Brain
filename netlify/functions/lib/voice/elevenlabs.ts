import { env } from '../env'

/**
 * ElevenLabs adapter — the ONLY place that talks to the vendor (CLAUDE.md:
 * feature code never calls STT/TTS APIs directly). Stage 1: request/response.
 * The realtime conversation stage swaps in streaming behind these same shapes.
 */

const API = 'https://api.elevenlabs.io/v1'

/**
 * Text → mp3 audio. Flash v2.5: low latency, natural, supports AU voices.
 * High stability + zero style = calm, even delivery (low stability made her
 * sound like she was shouting). previous_text keeps prosody continuous when
 * the client streams sentence-by-sentence — without it every sentence
 * restarts with fresh emphatic intonation.
 */
export async function synthesize(text: string, previousText?: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API}/text-to-speech/${env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.75, similarity_boost: 0.85, style: 0, speed: 0.96, use_speaker_boost: false },
      ...(previousText ? { previous_text: previousText.slice(-280) } : {}),
    }),
  })
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.arrayBuffer()
}

/** Audio → text via Scribe. */
export async function transcribe(audio: ArrayBuffer, mimeType: string): Promise<string> {
  const form = new FormData()
  form.append('model_id', 'scribe_v1')
  // PIN to English — without this Scribe auto-detects language and mis-fires on
  // Australian-accented speech (was transcribing Tony as Chinese). ISO-639.
  form.append('language_code', 'eng')
  // no non-speech event tags cluttering the transcript ("[laughter]" etc.)
  form.append('tag_audio_events', 'false')
  form.append('file', new Blob([audio], { type: mimeType }), 'audio')
  const res = await fetch(`${API}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
    body: form,
  })
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}
