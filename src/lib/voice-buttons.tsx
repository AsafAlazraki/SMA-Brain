import { useRef, useState } from 'react'
import { startRecording, transcribeBlob, speak, type Recorder } from './voice'

/** Mic: tap to talk, tap to finish — transcription (jargon-repaired) → onText. */
export function MicButton({ onText, big }: { onText: (text: string) => void; big?: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'busy'>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<Recorder | null>(null)

  async function toggle() {
    setError(null)
    if (state === 'idle') {
      try {
        recorder.current = await startRecording()
        setState('recording')
      } catch {
        setError('Mic blocked — allow microphone access and try again')
      }
      return
    }
    if (state === 'recording' && recorder.current) {
      setState('busy')
      try {
        const blob = await recorder.current.stop()
        const text = await transcribeBlob(blob)
        if (text) onText(text)
        else setError("Didn't catch that — have another go")
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err))
      } finally {
        recorder.current = null
        setState('idle')
      }
    }
  }

  const size = big ? 'min-h-12 min-w-12' : 'min-h-11 min-w-11'
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={state === 'busy'}
        aria-label={state === 'recording' ? 'Finish recording' : 'Talk instead of typing'}
        title={state === 'recording' ? 'Tap when you’re done' : 'Talk instead of typing'}
        className={`${size} flex items-center justify-center rounded border transition ${
          state === 'recording'
            ? 'border-safety-500 bg-safety-500/15 text-safety-400'
            : 'border-steel-600 text-cloth-400 hover:border-safety-500/60 hover:text-cloth-100'
        } ${state === 'busy' ? 'opacity-50' : ''}`}
      >
        {state === 'busy' ? (
          <span className="lamp" />
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        )}
        {state === 'recording' && <span className="absolute -right-1 -top-1 lamp" aria-hidden />}
      </button>
      {error && <span className="absolute left-full top-1/2 z-10 ml-2 w-44 -translate-y-1/2 text-[11px] leading-tight text-stop-500">{error}</span>}
    </div>
  )
}

/** Speaker: reads an answer out loud in the brain's voice. */
export function SpeakButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const stopRef = useRef<(() => void) | null>(null)

  async function toggle() {
    if (state === 'playing') {
      stopRef.current?.()
      setState('idle')
      return
    }
    if (state !== 'idle' || !text.trim()) return
    setState('loading')
    try {
      const { stop, done } = await speak(text)
      stopRef.current = stop
      setState('playing')
      await done
      setState('idle')
    } catch {
      setState('idle')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={state === 'playing' ? 'Stop reading' : 'Read it out'}
      title={state === 'playing' ? 'Stop' : 'Read it out'}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded border transition ${
        state === 'playing'
          ? 'border-safety-500 bg-safety-500/15 text-safety-400'
          : 'border-steel-700 text-cloth-600 hover:border-safety-500/50 hover:text-safety-400'
      }`}
    >
      {state === 'loading' ? (
        <span className="lamp" />
      ) : state === 'playing' ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
    </button>
  )
}
