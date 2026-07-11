import { useEffect, useRef, useState } from 'react'
import { streamSSE } from '../sse'
import { getAccessToken } from '../supabase'
import { startRecording, transcribeBlob, createSpeechStream, stripForSpeech, type Recorder } from '../voice'
import { Persona, type PersonaState } from '../persona/Persona'

/**
 * The call — a running conversation, not a walkie-talkie. Tap once to start;
 * she listens (silence ends your turn), starts talking on her first sentence
 * while the rest composes, then listens again — hands-free back-and-forth.
 * Rendered as a full-screen overlay from anywhere in the app (CallProvider).
 */
export function CallExperience({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<PersonaState>('idle')
  const [onCall, setOnCall] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const [caption, setCaption] = useState<string>('')
  const [note, setNote] = useState<string | null>(null)
  const levelRef = useRef(0)
  const recorder = useRef<Recorder | null>(null)
  const speech = useRef<ReturnType<typeof createSpeechStream> | null>(null)
  const conversationId = useRef<string | null>(null)
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  const stateRef = useRef(state)
  stateRef.current = state
  const onCallRef = useRef(onCall)
  onCallRef.current = onCall
  const vad = useRef({ heardSpeech: false, lastVoiceAt: 0, startedAt: 0 })

  useEffect(() => {
    return () => {
      recorder.current?.cancel()
      speech.current?.stop()
    }
  }, [])

  async function startListening() {
    if (!onCallRef.current || stateRef.current === 'listening') return
    setNote(null)
    try {
      vad.current = { heardSpeech: false, lastVoiceAt: 0, startedAt: performance.now() }
      recorder.current = await startRecording((l) => {
        levelRef.current = l
        const now = performance.now()
        const v = vad.current
        if (l > 0.12) {
          v.heardSpeech = true
          v.lastVoiceAt = now
        }
        if (stateRef.current !== 'listening') return
        const silentFor = now - Math.max(v.lastVoiceAt, v.startedAt)
        if ((v.heardSpeech && silentFor > 1400) || (!v.heardSpeech && now - v.startedAt > 9000) || now - v.startedAt > 60_000) {
          void finishListening()
        }
      })
      setState('listening')
    } catch {
      setNote('Mic blocked — allow microphone access and try again.')
      setOnCall(false)
      setState('idle')
    }
  }

  async function finishListening() {
    if (stateRef.current !== 'listening' || !recorder.current) return
    setState('thinking')
    levelRef.current = 0
    const rec = recorder.current
    recorder.current = null
    if (!vad.current.heardSpeech) {
      rec.cancel()
      setNote("Didn't hear anything — tap the mic when you're ready.")
      setOnCall(false)
      setState('idle')
      return
    }
    try {
      const blob = await rec.stop()
      const question = await transcribeBlob(blob)
      if (!question.trim()) {
        setNote("Didn't catch that — have another go.")
        setState('idle')
        if (onCallRef.current) void startListening()
        return
      }
      setHeard(question)
      setCaption('')
      await answer(question)
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err))
      setOnCall(false)
      setState('idle')
    }
  }

  async function answer(question: string) {
    let raw = ''
    const stream = createSpeechStream({
      onLevel: (l) => (levelRef.current = l),
      onStart: () => setState('speaking'),
      onEnd: () => {
        speech.current = null
        setState('idle')
        if (onCallRef.current) setTimeout(() => void startListening(), 250)
      },
    })
    speech.current = stream
    try {
      const token = await getAccessToken()
      await streamSSE(
        '/api/chat',
        { conversationId: conversationId.current, message: question, mode: 'voice', history: history.current },
        ({ event, data }) => {
          const d = data as Record<string, unknown>
          if (event === 'meta') conversationId.current = String(d.conversationId ?? '') || null
          if (event === 'token') {
            const delta = String(d.text ?? '')
            raw += delta
            setCaption(stripForSpeech(raw))
            stream.addText(delta)
          }
          if (event === 'error') setNote(String(d.message ?? 'The brain dropped out — try again.'))
        },
        { token },
      )
      stream.finish()
      const answerText = stripForSpeech(raw)
      if (answerText) {
        history.current = [
          ...history.current,
          { role: 'user' as const, content: question },
          { role: 'assistant' as const, content: answerText },
        ].slice(-8)
      }
      if (!stripForSpeech(raw)) {
        stream.stop()
        speech.current = null
        setState('idle')
        if (onCallRef.current) void startListening()
      }
    } catch (err) {
      stream.stop()
      speech.current = null
      setNote(String(err instanceof Error ? err.message : err))
      setOnCall(false)
      setState('idle')
    }
  }

  function onTalk() {
    setNote(null)
    if (stateRef.current === 'speaking') {
      speech.current?.stop()
      speech.current = null
      setState('idle')
      void startListening()
      return
    }
    if (stateRef.current === 'listening') {
      void finishListening()
      return
    }
    if (stateRef.current === 'idle') {
      setOnCall(true)
      onCallRef.current = true
      void startListening()
    }
  }

  function hangUp() {
    recorder.current?.cancel()
    speech.current?.stop()
    onClose()
  }

  const status = !onCall
    ? 'Tap the mic and just talk'
    : state === 'listening'
      ? 'Listening — pause when you’re done'
      : state === 'thinking'
        ? 'Thinking…'
        : state === 'speaking'
          ? 'Tap to jump in'
          : '…'

  return (
    <div className="flex h-full flex-col items-center overflow-hidden">
      {/* close (X) — always obvious */}
      <div className="flex w-full items-center justify-between px-4 pt-3">
        <span className="stamp !text-cloth-500">On a call</span>
        <button
          onClick={hangUp}
          aria-label="Close the call"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-cloth-400 transition hover:text-cloth-100"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 w-full flex-1 items-center justify-center px-6">
        <Persona state={state} levelRef={levelRef} className="h-full max-h-[42vh] w-auto max-w-full sm:max-h-[48vh]" />
      </div>

      <div className="text-center">
        <h1 className="display text-2xl text-cloth-100">
          The Brain<span className="text-safety-500">.</span>
        </h1>
        <p className={`stamp mt-1 ${state === 'listening' ? '!text-safety-400' : '!text-cloth-400'}`}>
          {state === 'thinking' ? (
            <span className="inline-flex items-center gap-2">
              <span className="lamp" /> {status}
            </span>
          ) : (
            status
          )}
        </p>
      </div>

      <div className="mt-3 min-h-[84px] w-full max-w-xl px-6 text-center">
        {heard && (
          <p className="stitched mx-auto mb-2 w-fit max-w-full truncate rounded-md bg-steel-800/70 px-3 py-1.5 text-[13px] text-denim-300">“{heard}”</p>
        )}
        {caption && <p className="mx-auto max-h-24 overflow-y-auto text-[15px] leading-relaxed text-cloth-100">{caption}</p>}
        {note && <p className="text-[13px] text-stop-500">{note}</p>}
      </div>

      <div className="flex items-center justify-center gap-8 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-4">
        {onCall && (
          <button
            onClick={hangUp}
            aria-label="Hang up"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-stop-500 text-white transition hover:brightness-110"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ transform: 'rotate(135deg)' }}>
              <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2Z" />
            </svg>
          </button>
        )}
        <button
          onClick={onTalk}
          disabled={state === 'thinking'}
          aria-label={status}
          className={`relative flex h-20 w-20 items-center justify-center rounded-full transition ${
            state === 'listening'
              ? 'bg-safety-500 text-safety-950 shadow-[0_0_0_10px_rgba(255,107,26,0.18)]'
              : state === 'speaking'
                ? 'border-2 border-safety-500 bg-steel-900 text-safety-400'
                : 'bg-safety-500 text-safety-950 shadow-[0_4px_0_rgba(0,0,0,0.5)]'
          } ${state === 'thinking' ? 'opacity-40' : 'hover:brightness-110 active:translate-y-0.5'}`}
        >
          {state === 'speaking' ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          )}
          {state === 'listening' && <span className="absolute inset-0 animate-ping rounded-full bg-safety-500/30" aria-hidden />}
        </button>
      </div>
    </div>
  )
}
