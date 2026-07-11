import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, isSupabaseConfigured, getAccessToken } from '../../lib/supabase'

type QueueItem = {
  id: string
  proposed_title: string
  proposed_content: string
  source_type: string
  status: string
  created_at: string
}

type UserRow = {
  id: string
  email: string | null
  role: 'admin' | 'staff'
  displayName: string
  createdAt: string | null
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h2 className="display text-2xl text-cloth-100">{children}</h2>
      <div className="seam seam-denim mt-1.5 w-16 opacity-60" aria-hidden />
    </div>
  )
}

export default function AdminPage() {
  const { data: queue, isLoading } = useQuery({
    queryKey: ['learning_queue'],
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<QueueItem[]> => {
      const { data, error } = await supabase!
        .from('learning_queue')
        .select('id, proposed_title, proposed_content, source_type, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50)
      if (error) throw error
      return data as QueueItem[]
    },
  })

  return (
    <div className="mx-auto h-full max-w-3xl space-y-8 overflow-y-auto p-4 pb-10">
      <section className="space-y-3">
        <SectionHeading>Training console</SectionHeading>
        <p className="text-[14px] leading-relaxed text-cloth-400">
          Approval queue, knowledge browser, gaps, style profile and settings land in build sessions S6–S7. This
          shell shows the pending learning queue.
        </p>
        {!isSupabaseConfigured && (
          <div className="stitched rounded-md bg-steel-900/60 p-4">
            <p className="text-sm text-cloth-400">
              No database connected — run <code className="font-mono text-safety-400">npm run db:start</code> and
              fill <code className="font-mono text-safety-400">.env</code> (README → Local setup).
            </p>
          </div>
        )}
        {isLoading && (
          <div className="flex items-center gap-2">
            <span className="lamp" />
            <span className="stamp">Loading queue…</span>
          </div>
        )}
        {queue?.length === 0 && (
          <p className="text-sm text-cloth-600">Queue is empty — the brain has nothing pending for review.</p>
        )}
        {queue?.map((q) => (
          <div key={q.id} className="plate rounded-md border-l-[3px] !border-l-denim-500 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-cloth-100">{q.proposed_title}</h3>
              <span className="stamp shrink-0 rounded-sm border border-steel-600 px-1.5 py-0.5">{q.source_type}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-cloth-400">{q.proposed_content}</p>
          </div>
        ))}
      </section>

      <UsersSection />
    </div>
  )
}

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
        <p className="rounded border border-stop-500/40 bg-stop-500/10 px-3 py-2 text-sm text-stop-500">
          {String(listError.message)}
        </p>
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
                  <span
                    className={`stamp rounded-sm border px-1.5 py-0.5 ${
                      u.role === 'admin' ? 'border-safety-500/60 !text-safety-400' : 'border-steel-600'
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
              </tr>
            ))}
            {users?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3.5 py-3 text-sm text-cloth-600">
                  No accounts yet — run <code className="font-mono text-safety-400">npm run seed:users</code> or add
                  one below.
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
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="Email"
          className="field min-h-12 px-4 text-[14px]"
        />
        <input
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
          placeholder="Display name"
          className="field min-h-12 px-4 text-[14px]"
        />
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value === 'admin' ? 'admin' : 'staff' }))}
          className="field min-h-12 px-4 text-[14px]"
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
        <input
          type="text"
          required
          minLength={8}
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder="Temporary password (8+ characters)"
          autoComplete="off"
          className="field min-h-12 px-4 text-[14px]"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="btn-safety display min-h-12 px-5 text-lg tracking-wide sm:col-span-2"
        >
          {create.isPending ? 'Creating…' : 'Add account'}
        </button>
      </form>

      {create.error && (
        <p className="rounded border border-stop-500/40 bg-stop-500/10 px-3 py-2 text-sm text-stop-500">
          {String(create.error.message)}
        </p>
      )}
      {notice && (
        <p className="rounded border border-go-500/40 bg-go-500/10 px-3 py-2 text-sm text-go-500">{notice}</p>
      )}
    </section>
  )
}
