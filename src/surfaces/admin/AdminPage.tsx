import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, isSupabaseConfigured, getAccessToken } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { MicButton } from '../../lib/voice-buttons'

type QueueItem = {
  id: string
  proposed_title: string
  proposed_content: string
  proposed_tags: string[]
  proposed_visibility: 'internal' | 'public'
  source_type: string
  created_at: string
  created_by: string | null
}

type Gap = { id: string; question: string; times_asked: number; status: string }

type UserRow = {
  id: string
  email: string | null
  role: 'admin' | 'staff'
  displayName: string
  createdAt: string | null
}

/** queue source_type → knowledge_entries.source (schema check constraint) */
const SOURCE_MAP: Record<string, string> = {
  teach_session: 'taught',
  blurt: 'taught',
  correction: 'correction',
  email_edit: 'email_edit',
  email_mining: 'manual',
  staff_suggestion: 'manual',
  autonomous_research: 'research',
  catalog_mining: 'catalog',
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div>
      <h2 className="display text-2xl text-cloth-100">
        {children}
        {count != null && count > 0 && (
          <span className="ml-2 rounded-sm bg-safety-500 px-1.5 py-0.5 align-middle font-mono text-[13px] font-semibold text-safety-950">
            {count}
          </span>
        )}
      </h2>
      <div className="seam seam-denim mt-1.5 w-16 opacity-60" aria-hidden />
    </div>
  )
}

export default function AdminPage() {
  return (
    <div className="mx-auto h-full max-w-3xl space-y-9 overflow-y-auto p-4 pb-12">
      <BlurtSection />
      <QueueSection />
      <GapsSection />
      <UsersSection />
    </div>
  )
}

/* ── Blurt: Tony's brain-dump box ─────────────────────────── */

function BlurtSection() {
  const queryClient = useQueryClient()
  const [transcript, setTranscript] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const blurt = useMutation({
    mutationFn: async (): Promise<number> => {
      const res = await fetch('/api/blurt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ transcript }),
      })
      const body = (await res.json().catch(() => null)) as { proposals?: number; error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? `Blurt failed (${res.status})`)
      return body?.proposals ?? 0
    },
    onSuccess: (n) => {
      setTranscript('')
      setNotice(n > 0 ? `${n} card${n === 1 ? '' : 's'} written up — they're in the queue below.` : 'Nothing distillable in that one — give it another crack with more detail.')
      void queryClient.invalidateQueries({ queryKey: ['learning_queue'] })
    },
  })

  return (
    <section className="space-y-3">
      <SectionHeading>Brain dump</SectionHeading>
      <p className="text-[14px] leading-relaxed text-cloth-400">
        Whatever's on your mind — machines, faults, policies, opinions. The brain writes it up into cards for your
        approval. Talk-to-it lands here next.
      </p>
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="Righto — the K6 hates cheap bonded nylon under Tex 90, tell people to…"
        rows={4}
        className="field w-full resize-y p-4 text-[15px] leading-relaxed"
      />
      <div className="flex items-center gap-3">
        <MicButton big onText={(t) => setTranscript((prev) => (prev ? `${prev}\n${t}` : t))} />
        <button
          onClick={() => {
            setNotice(null)
            blurt.mutate()
          }}
          disabled={blurt.isPending || transcript.trim().length < 10}
          className="btn-safety display min-h-12 px-6 text-lg tracking-wide"
        >
          {blurt.isPending ? 'Writing it up…' : 'Done — write it up'}
        </button>
        {notice && <p className="text-[13px] text-go-500">{notice}</p>}
        {blurt.error && <p className="text-[13px] text-stop-500">{String(blurt.error.message)}</p>}
      </div>
    </section>
  )
}

/* ── Approval queue ───────────────────────────────────────── */

function QueueSection() {
  const { session } = useAuth()
  const queryClient = useQueryClient()

  const { data: queue, isLoading } = useQuery({
    queryKey: ['learning_queue'],
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<QueueItem[]> => {
      const { data, error } = await supabase!
        .from('learning_queue')
        .select('id, proposed_title, proposed_content, proposed_tags, proposed_visibility, source_type, created_at, created_by')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50)
      if (error) throw error
      return data as QueueItem[]
    },
  })

  const review = useMutation({
    mutationFn: async (args: { item: QueueItem; verdict: 'approved' | 'rejected'; edits?: { title: string; content: string } }) => {
      const { item, verdict, edits } = args
      const userId = session?.user.id
      if (!supabase || !userId) throw new Error('Not signed in')
      let resultingEntryId: string | null = null
      if (verdict === 'approved') {
        const { data, error } = await supabase
          .from('knowledge_entries')
          .insert({
            title: edits?.title ?? item.proposed_title,
            content: edits?.content ?? item.proposed_content,
            tags: item.proposed_tags,
            visibility: item.proposed_visibility,
            status: 'approved',
            source: SOURCE_MAP[item.source_type] ?? 'manual',
            created_by: item.created_by,
            approved_by: userId,
            approved_at: new Date().toISOString(),
          })
          .select('id')
          .single()
        if (error) throw error
        resultingEntryId = data.id
      }
      const { error: qErr } = await supabase
        .from('learning_queue')
        .update({
          status: verdict,
          resulting_entry_id: resultingEntryId,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', item.id)
      if (qErr) throw qErr
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['learning_queue'] }),
  })

  return (
    <section className="space-y-3">
      <SectionHeading count={queue?.length}>Approval queue</SectionHeading>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] text-cloth-400">
          Nothing goes live until you approve it. Approve, tweak the wording first, or bin it.
        </p>
        <TeachYourselfButton onQueued={() => void queryClient.invalidateQueries({ queryKey: ['learning_queue'] })} />
      </div>
      {!isSupabaseConfigured && (
        <p className="stitched rounded-md bg-steel-900/60 p-4 text-sm text-cloth-400">
          No database connected — queue review needs Supabase (README → Local setup).
        </p>
      )}
      {isLoading && (
        <div className="flex items-center gap-2">
          <span className="lamp" />
          <span className="stamp">Loading queue…</span>
        </div>
      )}
      {queue?.length === 0 && <p className="text-sm text-cloth-600">Queue's clear — the brain has nothing pending for review.</p>}
      {review.error && <p className="text-[13px] text-stop-500">{String(review.error.message)}</p>}
      {queue?.map((q) => (
        <QueueCard
          key={q.id}
          item={q}
          busy={review.isPending}
          onReview={(verdict, edits) => review.mutate({ item: q, verdict, edits })}
        />
      ))}
    </section>
  )
}

/**
 * Kicks the autonomous learning run: the brain works its gaps, mines the
 * catalogue, researches what it can, verifies every finding, and fills this
 * queue. Runs in the background — the queue refreshes as cards land.
 */
function TeachYourselfButton({ onQueued }: { onQueued: () => void }) {
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle')
  async function run() {
    if (state === 'running') return
    setState('running')
    try {
      const token = await getAccessToken()
      const res = await fetch('/api/research/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxGaps: 8 }),
      })
      if (!res.ok && res.status !== 202) throw new Error(String(res.status))
      // results land over the next few minutes — poll the queue a couple of times
      const t1 = setTimeout(onQueued, 60_000)
      const t2 = setTimeout(() => {
        onQueued()
        setState('idle')
      }, 150_000)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    } catch {
      setState('error')
    }
  }
  return (
    <button
      onClick={() => void run()}
      disabled={state === 'running' || !isSupabaseConfigured}
      title="The brain researches its open gaps and fills the queue for you to approve"
      className="display flex min-h-11 items-center gap-2 rounded-md bg-safety-500 px-4 text-[15px] tracking-wide text-safety-950 transition hover:brightness-110 active:translate-y-0.5 disabled:opacity-50"
    >
      {state === 'running' ? (
        <>
          <span className="lamp" /> Learning…
        </>
      ) : state === 'error' ? (
        'Try again'
      ) : (
        'Teach yourself'
      )}
    </button>
  )
}

function QueueCard({
  item,
  busy,
  onReview,
}: {
  item: QueueItem
  busy: boolean
  onReview: (verdict: 'approved' | 'rejected', edits?: { title: string; content: string }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.proposed_title)
  const [content, setContent] = useState(item.proposed_content)

  return (
    <div className="plate rounded-md border-l-[3px] !border-l-denim-500 p-4">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="field w-full px-3 py-1.5 text-[15px] font-semibold" />
        ) : (
          <h3 className="text-[15px] font-semibold leading-snug text-cloth-100">{item.proposed_title}</h3>
        )}
        <span className="stamp shrink-0 rounded-sm border border-steel-600 px-1.5 py-0.5">{item.source_type.replace('_', ' ')}</span>
      </div>

      {editing ? (
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="field mt-2 w-full resize-y p-3 text-sm leading-relaxed" />
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-cloth-400">{item.proposed_content}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.proposed_tags?.map((t) => (
          <span key={t} className="rounded-sm border border-steel-700 px-1.5 py-0.5 font-mono text-[11px] text-cloth-600">{t}</span>
        ))}
        <span className={`stamp rounded-sm border px-1.5 py-0.5 ${item.proposed_visibility === 'public' ? 'border-go-500/50 !text-go-500' : 'border-steel-600'}`}>
          {item.proposed_visibility}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onReview('approved', editing ? { title, content } : undefined)}
          disabled={busy}
          className="btn-safety display min-h-11 px-5 text-base tracking-wide"
        >
          {editing ? 'Save & approve' : 'Approve'}
        </button>
        <button
          onClick={() => setEditing((e) => !e)}
          disabled={busy}
          className="stamp min-h-11 rounded border border-steel-600 px-4 !text-cloth-400 transition hover:border-denim-400 hover:!text-cloth-100"
        >
          {editing ? 'Cancel edit' : 'Edit'}
        </button>
        <button
          onClick={() => onReview('rejected')}
          disabled={busy}
          className="stamp min-h-11 rounded border border-steel-600 px-4 !text-cloth-600 transition hover:border-stop-500/60 hover:!text-stop-500"
        >
          Reject
        </button>
      </div>
    </div>
  )
}

/* ── Knowledge gaps ───────────────────────────────────────── */

function GapsSection() {
  const { data: gaps } = useQuery({
    queryKey: ['knowledge_gaps'],
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<Gap[]> => {
      const { data, error } = await supabase!
        .from('knowledge_gaps')
        .select('id, question, times_asked, status')
        .in('status', ['open', 'queued_for_teach'])
        .order('times_asked', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as Gap[]
    },
  })

  if (!isSupabaseConfigured || !gaps) return null
  return (
    <section className="space-y-3">
      <SectionHeading count={gaps.length}>What the brain doesn't know yet</SectionHeading>
      <p className="text-[14px] text-cloth-400">
        Questions staff asked that came up empty. Teach mode works through these — hit the Teach tab when you've got
        ten minutes.
      </p>
      {gaps.length === 0 && <p className="text-sm text-cloth-600">No open gaps — the brain's keeping up.</p>}
      <div className="space-y-1.5">
        {gaps.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-3 rounded-md border border-steel-700 bg-steel-900/60 px-3.5 py-2.5">
            <p className="text-[14px] leading-snug text-cloth-100">{g.question}</p>
            <span className="stamp shrink-0 rounded-sm border border-steel-600 px-1.5 py-0.5">×{g.times_asked}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── People (invite-only user management) ─────────────────── */

function UsersSection() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ email: '', displayName: '', role: 'staff' as 'staff' | 'admin', password: '' })
  const [notice, setNotice] = useState<string | null>(null)

  const { data: users, error: listError } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async (): Promise<UserRow[]> => {
      const res = await fetch('/api/admin/users', { headers: await authHeaders() })
      const body = (await res.json().catch(() => null)) as { users?: UserRow[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? `Failed to load accounts (${res.status})`)
      return body?.users ?? []
    },
  })

  const create = useMutation({
    mutationFn: async (): Promise<UserRow> => {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(form),
      })
      const body = (await res.json().catch(() => null)) as { user?: UserRow; error?: string } | null
      if (!res.ok || !body?.user) throw new Error(body?.error ?? `Could not create the account (${res.status})`)
      return body.user
    },
    onSuccess: (user) => {
      setNotice(`Account created — pass ${user.email} their sign-in details (they can't self-register).`)
      setForm({ email: '', displayName: '', role: 'staff', password: '' })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  return (
    <section className="space-y-3">
      <SectionHeading>People</SectionHeading>
      <p className="text-[14px] text-cloth-400">Invite-only — you create every account here; there's no self-signup.</p>

      {listError && (
        <p className="rounded border border-stop-500/40 bg-stop-500/10 px-3 py-2 text-sm text-stop-500">{String(listError.message)}</p>
      )}

      <div className="plate overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-steel-700">
              <th className="stamp px-3.5 py-2.5 font-normal">Name</th>
              <th className="stamp px-3.5 py-2.5 font-normal">Email</th>
              <th className="stamp px-3.5 py-2.5 font-normal">Role</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id} className="border-b border-steel-700/50 last:border-0">
                <td className="px-3.5 py-2.5 font-semibold text-cloth-100">{u.displayName || '—'}</td>
                <td className="px-3.5 py-2.5 font-mono text-[12.5px] text-cloth-400">{u.email}</td>
                <td className="px-3.5 py-2.5">
                  <span className={`stamp rounded-sm border px-1.5 py-0.5 ${u.role === 'admin' ? 'border-safety-500/60 !text-safety-400' : 'border-steel-600'}`}>
                    {u.role}
                  </span>
                </td>
              </tr>
            ))}
            {users?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3.5 py-3 text-sm text-cloth-600">
                  No accounts yet — run <code className="font-mono text-safety-400">npm run seed:users</code> or add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          setNotice(null)
          create.mutate()
        }}
      >
        <input type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" className="field min-h-12 px-4 text-[14px]" />
        <input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="Display name" className="field min-h-12 px-4 text-[14px]" />
        <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value === 'admin' ? 'admin' : 'staff' }))} className="field min-h-12 px-4 text-[14px]">
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
        <input type="text" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Temporary password (8+ characters)" autoComplete="off" className="field min-h-12 px-4 text-[14px]" />
        <button type="submit" disabled={create.isPending} className="btn-safety display min-h-12 px-5 text-lg tracking-wide sm:col-span-2">
          {create.isPending ? 'Creating…' : 'Add account'}
        </button>
      </form>

      {create.error && <p className="rounded border border-stop-500/40 bg-stop-500/10 px-3 py-2 text-sm text-stop-500">{String(create.error.message)}</p>}
      {notice && <p className="rounded border border-go-500/40 bg-go-500/10 px-3 py-2 text-sm text-go-500">{notice}</p>}
    </section>
  )
}
