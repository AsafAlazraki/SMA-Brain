import { useEffect, useRef, useState } from 'react'
import { useConversation } from '@elevenlabs/react'
import { getAccessToken } from '../supabase'
import { Persona, type PersonaState } from '../persona/Persona'

/**
 * The real call — ElevenLabs Conversational AI over WebRTC. ElevenLabs owns the
 * whole voice loop (listening, turn-taking, interruption, speaking, noise
 * cancellation); our Brain does the thinking via the custom-LLM bridge
 * (/api/agent). You just tap once and talk — no push-to-talk, cut in whenever.
 *
 * Must be rendered inside <ConversationProvider>.
 */
export function RealtimeCall({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'live' | 'unavailable' | 'error'>('idle')
  const [note, setNote] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const levelRef = useRef(0)

  const conversation = useConversation({
    onConnect: () => setPhase('live'),
    onDisconnect: () => setPhase((p) => (p === 'error' ? p : 'idle')),
    onError: (err: unknown) => {
      setNote(typeof err === 'string' ? err : (err as { message?: string })?.message ?? 'Voice dropped out — try again.')
      setPhase('error')
    },
    onMessage: (msg: unknown) => {
      const m = msg as { message?: string; source?: string }
      // show what she's saying; ignore the transcript of our own speech
      if (m.message && m.source !== 'user') setCaption(m.message)
    },
  })
  const { status, isSpeaking, isListening } = conversation

  // pulse the persona's ring to whoever's talking
  useEffect(() => {
    let raf = 0
    const tick = () => {
      try {
        const v = isSpeaking ? conversation.getOutputVolume?.() : conversation.getInputVolume?.()
        levelRef.current = typeof v === 'number' ? v : 0
      } catch {
        levelRef.current = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [conversation, isSpeaking])

  // end the session if the overlay unmounts
  useEffect(() => {
    return () => {
      try {
        conversation.endSession()
      } catch {
        /* already closed */
      }
    }
  }, [conversation])

  async function start() {
    setNote(null)
    setPhase('connecting')
    try {
      const token = await getAccessToken()
      const res = await fetch('/api/agent/token', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (res.status === 501) {
        setPhase('unavailable')
        return
      }
      const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null
      if (!res.ok || !body?.token) throw new Error(body?.error ?? `Couldn't start the call (${res.status})`)
      await conversation.startSession({ conversationToken: body.token, connectionType: 'webrtc' })
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  function hangUp() {
    try {
      conversation.endSession()
    } catch {
      /* already closed */
    }
    onClose()
  }

  const live = phase === 'live' && status === 'connected'
  const personaState: PersonaState = phase === 'connecting' ? 'thinking' : live ? (isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle') : 'idle'

  const statusLine =
    phase === 'connecting'
      ? 'Connecting…'
      : phase === 'unavailable'
        ? 'Voice isn’t switched on yet'
        : phase === 'error'
          ? 'Something went wrong'
          : live
            ? isSpeaking
              ? 'Speaking — cut in any time'
              : 'Listening — just talk'
            : 'Tap to start the call'

  return (
    <div className="flex h-full flex-col items-center overflow-hidden">
      <div className="flex w-full items-center justify-between px-4 pt-3">
        <span className="stamp !text-cloth-500">{live ? 'On a call' : 'The Brain'}</span>
        <button
          onClick={() => void hangUp()}
          aria-label="Close the call"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-cloth-400 transition hover:text-cloth-100"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 w-full flex-1 items-center justify-center px-6">
        <Persona state={personaState} levelRef={levelRef} className="h-full max-h-[42vh] w-auto max-w-full sm:max-h-[48vh]" />
      </div>

      <div className="text-center">
        <h1 className="display text-2xl text-cloth-100">
          The Brain<span className="text-safety-500">.</span>
        </h1>
        <p className={`stamp mt-1 ${live && isListening ? '!text-safety-400' : '!text-cloth-400'}`}>
          {phase === 'connecting' ? (
            <span className="inline-flex items-center gap-2">
              <span className="lamp" /> {statusLine}
            </span>
          ) : (
            statusLine
          )}
        </p>
      </div>

      <div className="mt-3 min-h-[84px] w-full max-w-xl px-6 text-center">
        {caption && live && <p className="mx-auto max-h-24 overflow-y-auto text-[15px] leading-relaxed text-cloth-100">{caption}</p>}
        {phase === 'unavailable' && (
          <p className="text-[14px] leading-relaxed text-cloth-400">
            The live voice isn’t connected yet — it needs the ElevenLabs agent set up. Until then, use the <strong>Ask</strong> tab to type to the Brain.
          </p>
        )}
        {note && phase === 'error' && <p className="text-[13px] text-stop-500">{note}</p>}
      </div>

      <div className="flex items-center justify-center gap-8 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-4">
        {live && (
          <button
            onClick={() => void hangUp()}
            aria-label="Hang up"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-stop-500 text-white transition hover:brightness-110"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ transform: 'rotate(135deg)' }}>
              <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2Z" />
            </svg>
          </button>
        )}
        {!live && phase !== 'connecting' && (
          <button
            onClick={() => void start()}
            disabled={phase === 'unavailable'}
            aria-label={statusLine}
            className="relative flex h-20 w-20 items-center justify-center rounded-full bg-safety-500 text-safety-950 shadow-[0_4px_0_rgba(0,0,0,0.5)] transition hover:brightness-110 active:translate-y-0.5 disabled:opacity-40"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
