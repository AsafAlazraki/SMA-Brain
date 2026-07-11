import { getAccessToken } from './supabase'

/**
 * Client voice helpers — recording (MediaRecorder) and spoken playback.
 * All vendor traffic goes through /api/voice/*; the browser never holds keys.
 */

export type Recorder = { stop: () => Promise<Blob>; cancel: () => void; mimeType: string }

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType =
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  rec.start(250)

  const cleanup = () => stream.getTracks().forEach((t) => t.stop())
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

/** Speak text out loud (brain's voice). Returns a stop function. */
export async function speak(text: string): Promise<{ stop: () => void; done: Promise<void> }> {
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
  const done = new Promise<void>((resolve) => {
    audio.onended = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
  })
  await audio.play()
  return {
    stop: () => {
      audio.pause()
      URL.revokeObjectURL(url)
    },
    done,
  }
}
