import { useEffect, useRef, useState } from 'react'
import { streamSSE } from '../../lib/sse'
import { getAccessToken } from '../../lib/supabase'

type Turn = { role: 'user' | 'assistant'; text: string }

/**
 * Teach mode (admin): the brain interviews Tony, driven by open knowledge
 * gaps. End the session and everything he said gets written up into cards
 * for the approval queue. Voice lands directly on this surface.
 */
export default function TeachPage() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [ended, setEnded] = useState<null | { proposals: number }>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns])

  async function interviewerTurn(history: Turn[]) {
    setBusy(true)
    setTurns([...history, { role: 'assistant', text: '' }])
    try {
      const token = await getAccessToken()
      await streamSSE(
        '/api/teach',
        { turns: history },
        ({ event, data }) => {
          const d = data as Record<string, unknown>
          if (event === 'token')
            setTurns((t) => {
              const copy = t.slice()
              const last = copy[copy.length - 1]
              if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, text: last.text + String(d.text ?? '') }
              return copy
            })
          if (event === 'error') setError(String(d.message ?? 'stream error'))
        },
        { token },
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  // open with the brain's first question
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void interviewerTurn([])
  }, [])

  async function answer() {
    if (!input.trim() || busy || ended) return
    const history: Turn[] = [...turns, { role: 'user', text: input.trim() }]
    setInput('')
    await interviewerTurn(history)
  }

  async function endSession() {
    if (busy || ended) return
    setBusy(true)
    setError(null)
    try {
      const token = await getAccessToken()
      const res = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ turns, end: true }),
      })
      const body = (await res.json().catch(() => null)) as { proposals?: number; error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? `Write-up failed (${res.status})`)
      setEnded({ proposals: body?.proposals ?? 0 })
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="stamp !text-cloth-400">Teach mode — the brain interviews you</p>
        <button
          onClick={() => void endSession()}
          disabled={busy || turns.filter((t) => t.role === 'user').length === 0 || Boolean(ended)}
          className="stamp min-h-11 rounded border border-steel-600 px-4 !text-cloth-400 transition hover:border-safety-500/60 hover:!text-cloth-100 disabled:opacity-40"
        >
          End session — write up cards
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="stitched ml-auto max-w-[85%] rounded-md bg-steel-800/80 px-4 py-2.5 text-[15px] leading-relaxed text-denim-300">
              {t.text}
            </div>
          ) : (
            <div key={i} className="plate max-w-[95%] rounded-md border-l-[3px] !border-l-denim-500 px-4 py-3">
              <p className={`whitespace-pre-wrap text-[15px] leading-relaxed text-cloth-100 ${busy && i === turns.length - 1 ? 'caret' : ''}`}>
                {t.text}
              </p>
            </div>
          ),
        )}

        {ended && (
          <div className="plate rounded-md border-l-[3px] !border-l-safety-500 px-4 py-3">
            <p className="text-[15px] text-cloth-100">
              Wrapped up — <strong className="font-bold">{ended.proposals} card{ended.proposals === 1 ? '' : 's'}</strong> written up and
              waiting in your <a href="/admin" className="text-safety-400 underline">approval queue</a>.
            </p>
          </div>
        )}
        {error && <p className="text-sm text-stop-500">{error}</p>}
      </div>

      <div className="seam seam-denim opacity-40" aria-hidden />
      <form
        className="flex gap-2 bg-iron-900/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault()
          void answer()
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ended ? 'Session ended — check the queue' : 'Answer like you would an apprentice…'}
          disabled={Boolean(ended)}
          className="field min-h-12 flex-1 px-4 text-[15px]"
        />
        <button type="submit" disabled={busy || !input.trim() || Boolean(ended)} className="btn-safety display min-h-12 px-6 text-lg tracking-wide">
          Send
        </button>
      </form>
    </div>
  )
}
