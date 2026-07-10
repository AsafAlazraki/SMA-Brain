import { useState } from 'react'
import { streamSSE } from '../../lib/sse'
import { getAccessToken } from '../../lib/supabase'

export default function DraftPage() {
  const [customerEmail, setCustomerEmail] = useState('')
  const [draft, setDraft] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [mined, setMined] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (!customerEmail.trim() || busy) return
    setBusy(true)
    setDraft('')
    setMined([])
    setCopied(false)
    try {
      const token = await getAccessToken()
      await streamSSE(
        '/api/draft',
        { customerEmail },
        ({ event, data }) => {
          const d = data as Record<string, unknown>
          if (event === 'meta') setDraftId(String(d.draftId ?? '') || null)
          if (event === 'mined') setMined((d.questions as string[]) ?? [])
          if (event === 'token') setDraft((prev) => prev + String(d.text ?? ''))
        },
        { token },
      )
    } catch (err) {
      setDraft((prev) => prev || `Something went wrong: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function copyOut() {
    await navigator.clipboard.writeText(draft)
    setCopied(true)
    // Fire-and-forget learning capture: what actually left the building.
    const token = await getAccessToken()
    void fetch('/api/draft-finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ draftId, finalText: draft }),
    }).catch(() => {})
  }

  return (
    <div className="mx-auto grid h-full max-w-6xl gap-4 p-4 md:grid-cols-2">
      <section className="flex min-h-0 flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-400">Customer's email</h2>
        <textarea
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          placeholder="Paste the customer's email here — threads are fine, we'll find the questions…"
          className="min-h-0 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-orange-500/60 focus:outline-none"
        />
        <button
          onClick={() => void generate()}
          disabled={busy || !customerEmail.trim()}
          className="min-h-11 rounded-xl bg-orange-500 px-5 text-sm font-semibold text-slate-950 transition disabled:opacity-40"
        >
          {busy ? 'Drafting…' : 'Draft reply in Tony’s voice'}
        </button>
        {mined.length > 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-400">
            <span className="text-slate-500">They're asking:</span> {mined.join(' · ')}
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-400">Draft reply — edit freely</h2>
          <button
            onClick={() => void copyOut()}
            disabled={!draft || busy}
            className="min-h-11 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-300 transition hover:border-orange-500/50 disabled:opacity-40"
          >
            {copied ? '✓ Copied (brain is learning)' : 'Copy'}
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="The drafted reply appears here, streaming…"
          className="min-h-0 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-orange-500/60 focus:outline-none"
        />
      </section>
    </div>
  )
}
