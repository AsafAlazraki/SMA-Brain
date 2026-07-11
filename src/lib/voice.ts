import { getAccessToken } from './supabase'

/** Markdown/citations → plain speakable prose. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/<cited>[\s\S]*?(<\/cited>|$)/g, '')
    .replace(/<draft>[\s\S]*?(<\/draft>|$)/g, '') // drafts render on screen, never read aloud
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

/** Fetch synthesized speech for a chunk of text. Returns null on failure. */
async function fetchSpeech(text: string, previousText?: string): Promise<Blob | null> {
  try {
    const token = await getAccessToken()
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text, ...(previousText ? { previous_text: previousText } : {}) }),
    })
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

/** Play one audio blob with optional lip-sync metering. */
function playBlob(blob: Blob, onLevel?: (level: number) => void): { stop: () => void; done: Promise<void> } {
  const url = URL.createObjectURL(blob)
  currentAudio?.pause()
  const audio = new Audio(url)
  currentAudio = audio

  let stopMeter: (() => void) | null = null
  if (onLevel) {
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
  void audio.play().catch(() => {
    finish()
  })
  return {
    stop: () => {
      audio.pause()
      finish()
    },
    done,
  }
}

/**
 * Speak text out loud (brain's voice). Returns a stop function.
 * onLevel (optional) receives 0..1 speech amplitude — drives the persona's lips.
 */
export async function speak(
  text: string,
  onLevel?: (level: number) => void,
): Promise<{ stop: () => void; done: Promise<void> }> {
  const blob = await fetchSpeech(text)
  if (!blob) throw new Error('Voice unavailable')
  return playBlob(blob, onLevel)
}

/**
 * Ordered playback of server-synthesized audio: /api/chat (voice mode) pushes
 * base64 mp3 'audio' events down the SSE stream, already in sentence order.
 * Play each as it lands; finish(count) marks how many to expect.
 */
export function createOrderedPlayer(handlers: {
  onLevel?: (level: number) => void
  onStart?: () => void
  onEnd?: () => void
}): { add: (b64: string) => void; finish: (count: number) => void; stop: () => void } {
  let stopped = false
  let started = false
  let expected: number | null = null
  let played = 0
  let playChain = Promise.resolve()
  let currentStop: (() => void) | null = null

  const maybeEnd = () => {
    if (!stopped && expected !== null && played >= expected) handlers.onEnd?.()
  }

  return {
    add(b64) {
      if (stopped) return
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      playChain = playChain.then(async () => {
        if (stopped) {
          played++
          return
        }
        if (!started) {
          started = true
          handlers.onStart?.()
        }
        const { stop, done } = playBlob(blob, handlers.onLevel)
        currentStop = stop
        await done
        currentStop = null
        played++
        maybeEnd()
      })
    },
    finish(count) {
      expected = count
      maybeEnd()
    },
    stop() {
      stopped = true
      currentStop?.()
      handlers.onLevel?.(0)
    },
  }
}

/**
 * Sentence-streamed speech: feed streamed answer text in as it arrives; each
 * completed sentence is synthesized immediately (max 2 in flight — free-plan
 * concurrency) and played in order, so she starts talking on sentence one
 * while the rest is still being written.
 */
export function createSpeechStream(handlers: {
  onLevel?: (level: number) => void
  onStart?: () => void
  onEnd?: () => void
}): { addText: (delta: string) => void; finish: () => void; stop: () => void } {
  let buffer = ''
  let stopped = false
  let started = false
  let finished = false
  const fetchQueue: Promise<Blob | null>[] = []
  let inFlight = 0
  const backlog: string[] = []
  let playChain = Promise.resolve()
  let currentStop: (() => void) | null = null
  let queuedCount = 0
  let playedCount = 0

  const maybeEnd = () => {
    if (finished && backlog.length === 0 && inFlight === 0 && playedCount === queuedCount && !stopped) {
      handlers.onEnd?.()
    }
  }

  let prevSynthesized = ''
  const pump = () => {
    while (!stopped && inFlight < 2 && backlog.length > 0) {
      const sentence = backlog.shift()!
      inFlight++
      queuedCount++
      // previous_text keeps her intonation flowing across sentence chunks
      const prev = prevSynthesized
      prevSynthesized = sentence
      const p = fetchSpeech(sentence, prev || undefined).then((blob) => {
        inFlight--
        pump()
        return blob
      })
      fetchQueue.push(p)
      playChain = playChain.then(async () => {
        const blob = await p
        if (stopped || !blob) {
          playedCount++
          maybeEnd()
          return
        }
        if (!started) {
          started = true
          handlers.onStart?.()
        }
        const { stop, done } = playBlob(blob, handlers.onLevel)
        currentStop = stop
        await done
        currentStop = null
        playedCount++
        maybeEnd()
      })
    }
  }

  const enqueue = (sentence: string) => {
    const clean = sentence.trim()
    if (clean.length < 2) return
    backlog.push(clean)
    pump()
  }

  const drainBuffer = (flushAll: boolean) => {
    // split on sentence enders; hold short fragments back for merging
    for (;;) {
      const m = /[.!?…]+["')\]]?\s/.exec(buffer)
      if (!m) break
      const end = m.index + m[0].length
      const candidate = buffer.slice(0, end)
      if (candidate.trim().length < 24 && buffer.length < 160 && !flushAll) break
      enqueue(candidate)
      buffer = buffer.slice(end)
    }
    if (flushAll && buffer.trim()) {
      enqueue(buffer)
      buffer = ''
    }
  }

  return {
    addText(delta) {
      if (stopped) return
      buffer += delta
      drainBuffer(false)
    },
    finish() {
      if (stopped || finished) return
      drainBuffer(true)
      finished = true
      maybeEnd()
    },
    stop() {
      stopped = true
      backlog.length = 0
      currentStop?.()
      handlers.onLevel?.(0)
    },
  }
}
