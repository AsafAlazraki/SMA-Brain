import { useRef, useState } from 'react'
import { streamSSE } from '../../lib/sse'
import { getAccessToken } from '../../lib/supabase'
import { startRecording, transcribeBlob, speak, stripForSpeech, type Recorder } from '../../lib/voice'
import { Persona, type PersonaState } from '../../lib/persona/Persona'

/**
 * The call — FaceTime with the brain. Tap to talk, she listens, thinks,
 * and answers out loud (Arabella, en-AU) with live captions. Turn-based v1;
 * the hands-free interruptible build rides on this same surface later.
 */

export default function CallPage() {
  const [state, setState] = useState<PersonaState>('idle')
  const [heard, setHeard] = useState<string | null>(null)
  const [caption, setCaption] = useState<string>('')
  const [note, setNote] = useState<string | null>(null)
  const levelRef = useRef(0)
  const recorder = useRef<Recorder | null>(null)
  const stopSpeech = useRef<(() => void) | null>(null)
  const conversationId = useRef<string | null>(null)

  async function onTalk() {
    setNote(null)

    if (state === 'speaking') {
      stopSpeech.current?.()
      stopSpeech.current = null
      setState('idle')
      return
    }

    if (state === 'idle') {
      try {
        recorder.current = await startRecording((l) => (levelRef.current = l))
        setHeard(null)
        setCaption('')
        setState('listening')
      } catch {
        setNote('Mic blocked — allow microphone access in your browser and try again.')
      }
      return
    }

    if (state === 'listening' && recorder.current) {
      setState('thinking')
      levelRef.current = 0
      try {
        const blob = await recorder.current.stop()
        recorder.current = null
        const question = await transcribeBlob(blob)
        if (!question.trim()) {
          setNote("Didn't catch that — have another go.")
          setState('idle')
          return
        }
        setHeard(question)
        await answer(question)
      } catch (err) {
        setNote(String(err instanceof Error ? err.message : err))
        setState('idle')
      }
    }
  }

  async function answer(question: string) {
    let text = ''
    try {
      const token = await getAccessToken()
      await streamSSE(
        '/api/chat',
        { conversationId: conversationId.current, message: question, mode: 'call' },
        ({ event, data }) => {
          const d = data as Record<string, unknown>
          if (event === 'meta') conversationId.current = String(d.conversationId ?? '') || null
          if (event === 'token') {
            text += String(d.text ?? '')
            setCaption(stripForSpeech(text))
          }
        },
        { token },
      )
      const speech = stripForSpeech(text)
      if (!speech) {
        setNote('The brain came back empty — try asking again.')
        setState('idle')
        return
      }
      setState('speaking')
      const { stop, done } = await speak(speech, (l) => (levelRef.current = l))
      stopSpeech.current = stop
      await done
      stopSpeech.current = null
      setState('idle')
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err))
      setState('idle')
    }
  }

  const status =
    state === 'listening'
      ? 'Listening — tap when you’re done'
      : state === 'thinking'
        ? 'Thinking…'
        : state === 'speaking'
          ? 'Tap to interrupt'
          : 'Tap to talk'

  return (
    <div className="relative flex h-full flex-col items-center overflow-hidden">
      {/* she fills the scene */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center px-6 pt-2">
        <Persona state={state} levelRef={levelRef} className="h-full max-h-[46vh] w-auto max-w-full sm:max-h-[52vh]" />
      </div>

      {/* nameplate + status */}
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

      {/* captions */}
      <div className="mt-3 min-h-[88px] w-full max-w-xl px-6 text-center">
        {heard && <p className="stitched mx-auto mb-2 w-fit max-w-full rounded-md bg-steel-800/70 px-3 py-1.5 text-[13px] text-denim-300">“{heard}”</p>}
        {caption && (
          <p className="mx-auto max-h-24 overflow-y-auto text-[15px] leading-relaxed text-cloth-100">{caption}</p>
        )}
        {note && <p className="text-[13px] text-stop-500">{note}</p>}
      </div>

      {/* the big button */}
      <div className="flex items-center justify-center gap-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        <button
          onClick={() => void onTalk()}
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
