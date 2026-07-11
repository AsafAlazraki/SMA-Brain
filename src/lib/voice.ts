import { getAccessToken } from './supabase'

/** Markdown/citations → plain speakable prose. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/<cited>[\s\S]*?(<\/cited>|$)/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .trim()
}

/**
 * Client voice helpers — recording (MediaRecorder) and spoken playback.
 * All vendor traffic goes through /api/voice/*; the browser never holds keys.
 */

export type Recorder = { stop: () => Promise<Blob>; cancel: () => void; mimeType: string }

/** Shared AudioContext — created lazily inside a user gesture. */
let audioCtx: AudioContext | null = null
function ctx(): AudioContext {
  audioCtx ??= new AudioContext()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

/** rAF loop reporting 0..1 RMS level from an analyser until stopped. */
function meter(analyser: AnalyserNode, onLevel: (level: number) => void): () => void {
  const data = new Uint8Array(analyser.fftSize)
  let raf = 0
  const tick = () => {
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128
      sum += v * v
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2))
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

export async function startRecording(onLevel?: (level: number) => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType =
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  rec.start(250)

  let stopMeter: (() => void) | null = null
  if (onLevel) {
    const analyser = ctx().createAnalyser()
    analyser.fftSize = 512
    ctx().createMediaStreamSource(stream).connect(analyser) // analysis only — not routed to speakers
    stopMeter = meter(analyser, onLevel)
  }

  const cleanup = () => {
    stopMeter?.()
    stream.getTracks().forEach((t) => t.stop())
  }
  return {
    mimeType: rec.mimeType || 'audio/webm',
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          cleanup()
          resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
        }
        rec.stop()
      }),
    cancel: () => {
      rec.onstop = null
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
      cleanup()
    },
  }
}

/** Recording → text (Scribe + jargon repair, server-side). */
export async function transcribeBlob(blob: Blob): Promise<string> {
  const token = await getAccessToken()
  const res = await fetch('/api/voice/stt', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: blob,
  })
  const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `Transcription failed (${res.status})`)
  return body?.text ?? ''
}

let currentAudio: HTMLAudioElement | null = null

/**
 * Speak text out loud (brain's voice). Returns a stop function.
 * onLevel (optional) receives 0..1 speech amplitude — drives the persona's lips.
 */
export async function speak(
  text: string,
  onLevel?: (level: number) => void,
): Promise<{ stop: () => void; done: Promise<void> }> {
  const token = await getAccessToken()
  const res = await fetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Voice failed (${res.status})`)
  }
  const url = URL.createObjectURL(await res.blob())
  currentAudio?.pause()
  const audio = new Audio(url)
  currentAudio = audio

  let stopMeter: (() => void) | null = null
  if (onLevel) {
    // route through the shared context so the analyser hears the playback
    const source = ctx().createMediaElementSource(audio)
    const analyser = ctx().createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    analyser.connect(ctx().destination)
    stopMeter = meter(analyser, onLevel)
  }

  const finish = () => {
    stopMeter?.()
    onLevel?.(0)
    URL.revokeObjectURL(url)
  }
  const done = new Promise<void>((resolve) => {
    audio.onended = () => {
      finish()
      resolve()
    }
    audio.onerror = () => {
      finish()
      resolve()
    }
  })
  await audio.play()
  return {
    stop: () => {
      audio.pause()
      finish()
    },
    done,
  }
}
