import { useRef, useState } from 'react'
import { streamSSE } from '../../lib/sse'
import { getAccessToken } from '../../lib/supabase'

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
}

const SUGGESTIONS = [
  'Customer sews shade sails — what machine do we recommend?',
  'What needle system does the LU-2810 take?',
  'Thread and needle for Tex 92 on canvas?',
  "Why would a K6 skip stitches on horse rugs?",
]

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [callMode, setCallMode] = useState(false)
  const conversationId = useRef<string | null>(null)

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
      <div className="flex items-center justify-end gap-2 px-4 pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={callMode} onChange={(e) => setCallMode(e.target.checked)} className="accent-orange-500" />
          On a call (fast answers)
        </label>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="mt-10 space-y-3">
            <p className="text-center text-sm text-slate-500">Ask the brain anything — machines, needles, thread, policies.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  className="min-h-11 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-left text-sm text-slate-300 transition hover:border-orange-500/40 hover:text-orange-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-orange-500/15 px-4 py-2.5 text-sm text-orange-100">
              {t.text}
            </div>
          ) : (
            <div key={i} className="max-w-[95%] space-y-2">
              {t.toolStatus && <div className="text-xs italic text-slate-500">⚙ {t.toolStatus}</div>}
              <div className={`whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-900 px-4 py-2.5 text-sm leading-relaxed text-slate-200 ${t.streaming ? 'caret' : ''}`}>
                {t.text}
              </div>
              {t.products?.map((p) => (
                <a
                  key={p.id}
                  href={p.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-slate-700 bg-slate-900/80 p-3 transition hover:border-orange-500/50"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-100">
                      {p.brand} {p.model} — {p.name}
                    </span>
                    {p.price_ex_gst != null && <span className="whitespace-nowrap text-sm text-orange-300">${p.price_ex_gst.toLocaleString()} ex GST</span>}
                  </div>
                  {p.fit_note && <p className="mt-1 text-xs text-slate-400">{p.fit_note}</p>}
                </a>
              ))}
              {t.citations && t.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {t.citations.map((c) => (
                    <span key={c.id} className="rounded-full border border-slate-800 px-2 py-0.5 text-[11px] text-slate-500">
                      📎 {c.title}
                    </span>
                  ))}
                </div>
              )}
              {t.gap && <div className="text-xs text-amber-400/80">Logged as a knowledge gap for Tony: “{t.gap}”</div>}
            </div>
          ),
        )}
      </div>

      <form
        className="flex gap-2 border-t border-slate-800 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={callMode ? 'Quick — what do they need?' : 'Ask the brain…'}
          className="min-h-11 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="min-h-11 rounded-xl bg-orange-500 px-5 text-sm font-semibold text-slate-950 transition disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  )
}
