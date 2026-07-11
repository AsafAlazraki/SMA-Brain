import { useEffect, useRef, useState } from 'react'
import { streamSSE } from '../../lib/sse'
import { getAccessToken } from '../../lib/supabase'
import { Markdown } from '../../lib/markdown'

type ProductCard = {
  id: string
  sku?: string
  brand?: string
  model?: string
  name: string
  price_ex_gst?: number
  url?: string
  fit_note?: string
}

type Citation = { id: string; title: string }

type Turn = {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  toolStatus?: string | null
  citations?: Citation[]
  products?: ProductCard[]
  gap?: string | null
  corrected?: boolean
}

const SUGGESTIONS = [
  'Customer sews shade sails — what machine do we recommend?',
  'What needle system does the LU-2810 take?',
  'Thread and needle for Tex 92 on canvas?',
  'Why would a K6 skip stitches on horse rugs?',
]

/** Interim: hide the model's <cited> block from display (S4 parses it server-side). */
function displayText(text: string): string {
  return text.replace(/<cited>[\s\S]*?(<\/cited>|$)/g, '').trimEnd()
}

/** Flag a wrong answer → correction goes to Tony's approval queue. */
function CorrectionFlow({ turn, question, onSent }: { turn: Turn; question: string; onSent: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (turn.corrected) {
    return <p className="stamp pl-1 !text-go-500">✓ Correction sent to Tony's queue</p>
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="stamp pl-1 !text-cloth-600 transition hover:!text-safety-400">
        Wrong? Set it straight
      </button>
    )
  }

  async function submit() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const token = await getAccessToken()
      const res = await fetch('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ question, answer: displayText(turn.text), correction: text.trim() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Failed (${res.status})`)
      }
      onSent()
    } catch (err) {
      setError(String(err))
      setBusy(false)
    }
  }

  return (
    <div className="stitched space-y-2 rounded-md bg-steel-900/60 p-3">
      <p className="stamp !text-cloth-400">What's the right answer?</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="e.g. Nah — the K6 takes 794 needles for that job, not 135x17…"
        className="field w-full resize-y p-3 text-[14px] leading-relaxed"
      />
      {error && <p className="text-[13px] text-stop-500">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={busy || !text.trim()} className="btn-safety display min-h-11 px-4 text-base tracking-wide">
          {busy ? 'Sending…' : 'Send to Tony'}
        </button>
        <button onClick={() => setOpen(false)} disabled={busy} className="stamp min-h-11 rounded border border-steel-600 px-3 !text-cloth-600">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [callMode, setCallMode] = useState(false)
  const conversationId = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns])

  async function ask(question: string) {
    if (!question.trim() || busy) return
    setBusy(true)
    setInput('')
    setTurns((t) => [...t, { role: 'user', text: question }, { role: 'assistant', text: '', streaming: true }])

    const patch = (fn: (last: Turn) => Turn) =>
      setTurns((t) => {
        const copy = t.slice()
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant') copy[copy.length - 1] = fn(last)
        return copy
      })

    try {
      const token = await getAccessToken()
      await streamSSE(
        '/api/chat',
        { conversationId: conversationId.current, message: question, mode: callMode ? 'call' : 'chat' },
        ({ event, data }) => {
          const d = data as Record<string, unknown>
          if (event === 'meta') conversationId.current = String(d.conversationId ?? '') || null
          if (event === 'tool') patch((l) => ({ ...l, toolStatus: d.status === 'end' ? null : String(d.summary ?? 'thinking…') }))
          if (event === 'token') patch((l) => ({ ...l, text: l.text + String(d.text ?? '') }))
          if (event === 'citations') patch((l) => ({ ...l, citations: d.entries as Citation[] }))
          if (event === 'product_card') patch((l) => ({ ...l, products: [...(l.products ?? []), d as unknown as ProductCard] }))
          if (event === 'gap') patch((l) => ({ ...l, gap: String((d as { question?: string }).question ?? '') }))
          if (event === 'error')
            patch((l) => ({
              ...l,
              streaming: false,
              toolStatus: null,
              text: l.text || 'The brain dropped out mid-answer — give it another go.',
            }))
          if (event === 'done') patch((l) => ({ ...l, streaming: false, toolStatus: null }))
        },
        { token },
      )
    } catch (err) {
      patch((l) => ({ ...l, streaming: false, text: l.text || `Something went wrong: ${String(err)}` }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex items-center justify-end px-4 pt-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={callMode}
            onChange={(e) => setCallMode(e.target.checked)}
            className="h-4 w-4 accent-[--color-safety-500]"
          />
          <span className={`stamp ${callMode ? '!text-safety-400' : ''}`}>On a call — fast answers</span>
        </label>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4 pt-2">
        {turns.length === 0 && (
          <div className="mt-8">
            <h2 className="rise display text-[38px] leading-none text-cloth-100">
              G'day<span className="text-safety-500">.</span>
            </h2>
            <p className="rise rise-1 mt-2 text-[15px] text-cloth-400">
              Ask the brain anything — machines, needles, thread, policies.
            </p>
            <div className="rise rise-2 mt-6 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  className="stitched min-h-12 rounded-md bg-steel-900/60 px-4 py-3 text-left text-[14px] leading-snug text-cloth-400 transition hover:border-safety-500/70 hover:text-cloth-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            /* fabric patch — stitched, denim */
            <div
              key={i}
              className="stitched ml-auto max-w-[85%] rounded-md bg-steel-800/80 px-4 py-2.5 text-[15px] leading-relaxed text-denim-300"
            >
              {t.text}
            </div>
          ) : (
            <div key={i} className="max-w-[97%] space-y-2.5">
              {t.toolStatus && (
                <div className="flex items-center gap-2 pl-1">
                  <span className="lamp" />
                  <span className="stamp !text-denim-400">{t.toolStatus}</span>
                </div>
              )}

              {(t.text || t.streaming) && (
                /* bench plate — orange seam down the left */
                <div className="plate rounded-md border-l-[3px] !border-l-safety-500 px-4 py-3">
                  <div className={`text-[15px] leading-relaxed text-cloth-100 ${t.streaming ? 'caret' : ''}`}>
                    <Markdown text={displayText(t.text)} />
                  </div>
                </div>
              )}

              {t.products?.map((p) => (
                /* parts-bin label */
                <a
                  key={p.id}
                  href={p.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="plate block rounded-md p-3.5 transition hover:!border-safety-500/60"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="stamp !text-denim-400">{p.sku ?? 'CATALOGUE'}</span>
                    {p.price_ex_gst != null && (
                      <span className="rounded-sm bg-safety-500 px-2 py-0.5 font-mono text-[13px] font-semibold text-safety-950">
                        ${p.price_ex_gst.toLocaleString()} <span className="text-[10px]">EX GST</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[15px] font-semibold text-cloth-100">
                    {p.brand} <span className="font-mono text-denim-300">{p.model}</span> — {p.name}
                  </p>
                  {p.fit_note && <p className="mt-1 text-[13px] leading-snug text-cloth-400">{p.fit_note}</p>}
                </a>
              ))}

              {t.citations && t.citations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pl-1">
                  <span className="stamp">Sources</span>
                  {t.citations.map((c) => (
                    <span
                      key={c.id}
                      className="max-w-[16rem] truncate rounded-sm border border-steel-600 bg-steel-900 px-2 py-1 font-mono text-[11px] text-denim-300"
                      title={c.title}
                    >
                      {c.title}
                    </span>
                  ))}
                </div>
              )}

              {t.gap && (
                <p className="pl-1 text-[13px] leading-snug text-safety-400">
                  <span className="stamp !text-safety-400">Gap logged for Tony</span> — “{t.gap}”
                </p>
              )}

              {!t.streaming && t.text && (
                <CorrectionFlow
                  turn={t}
                  question={turns[i - 1]?.text ?? ''}
                  onSent={() =>
                    setTurns((all) => all.map((x, j) => (j === i ? { ...x, corrected: true } : x)))
                  }
                />
              )}
            </div>
          ),
        )}
      </div>

      <div className="seam seam-denim opacity-40" aria-hidden />
      <form
        className="flex gap-2 bg-iron-900/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={callMode ? 'Quick — what do they need?' : 'Ask the brain…'}
          className="field min-h-12 flex-1 px-4 text-[15px]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="btn-safety display min-h-12 px-6 text-lg tracking-wide"
        >
          Ask
        </button>
      </form>
    </div>
  )
}
