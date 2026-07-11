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
          // interim: scrub the model's <cited> block from the copyable draft (S4 moves this server-side)
          if (event === 'done') setDraft((prev) => prev.replace(/<cited>[\s\S]*?(<\/cited>|$)/g, '').trimEnd())
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
        <h2 className="stamp !text-cloth-400">Their email</h2>
        <textarea
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          placeholder="Paste the customer's email here — threads are fine, we'll find the questions…"
          className="field min-h-0 flex-1 resize-none p-4 text-[14px] leading-relaxed"
        />
        <button
          onClick={() => void generate()}
          disabled={busy || !customerEmail.trim()}
          className="btn-safety display min-h-12 px-5 text-lg tracking-wide"
        >
          {busy ? 'Drafting…' : 'Draft reply in Tony’s voice'}
        </button>
        {mined.length > 0 && (
          <div className="stitched rounded-md bg-steel-900/60 px-3 py-2">
            <span className="stamp">They're asking</span>
            <p className="mt-1 text-[13px] leading-snug text-cloth-400">{mined.join(' · ')}</p>
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="stamp !text-cloth-400">Your reply — edit freely</h2>
          <button
            onClick={() => void copyOut()}
            disabled={!draft || busy}
            className={`stamp min-h-11 rounded border px-3 transition disabled:opacity-40 ${
              copied
                ? 'border-go-500/60 !text-go-500'
                : 'border-steel-600 !text-cloth-400 hover:border-safety-500/60 hover:!text-cloth-100'
            }`}
          >
            {copied ? '✓ Copied — brain is learning' : 'Copy'}
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="The drafted reply appears here, streaming…"
          className="field min-h-0 flex-1 resize-none p-4 text-[14px] leading-relaxed"
        />
      </section>
    </div>
  )
}
