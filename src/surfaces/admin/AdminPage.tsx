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
    <div className="mx-auto max-w-3xl space-y-6 overflow-y-auto p-4">
      <section className="space-y-3">
        <h1 className="text-lg font-semibold text-slate-200">Training console</h1>
        <p className="text-sm text-slate-500">
          Approval queue, knowledge browser, gaps, style profile and settings land in build sessions S6–S7. This shell
          shows the pending learning queue once Supabase is connected.
        </p>
        {!isSupabaseConfigured && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
            Supabase not configured — run <code className="text-orange-300">npm run db:start</code> and set{' '}
            <code className="text-orange-300">.env</code> (see README → Local setup).
          </div>
        )}
        {isLoading && <div className="text-sm text-slate-500">Loading queue…</div>}
        {queue?.length === 0 && <div className="text-sm text-slate-500">Queue is empty — the brain has nothing pending for review.</div>}
        {queue?.map((q) => (
          <div key={q.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200">{q.proposed_title}</h3>
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-500">{q.source_type}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{q.proposed_content}</p>
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
    <section className="space-y-3 border-t border-slate-800 pt-5">
      <h2 className="text-base font-semibold text-slate-200">People</h2>
      <p className="text-sm text-slate-500">Invite-only — you create every account here; there's no self-signup.</p>

      {listError && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{String(listError.message)}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id} className="border-b border-slate-800/60 last:border-0">
                <td className="px-3 py-2 text-slate-300">{u.displayName || '—'}</td>
                <td className="px-3 py-2 text-slate-400">{u.email}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      u.role === 'admin' ? 'border-orange-500/40 text-orange-300' : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
              </tr>
            ))}
            {users?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-sm text-slate-500">
                  No accounts yet — run <code className="text-orange-300">npm run seed:users</code> or add one below.
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
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500/60 focus:outline-none"
        />
        <input
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
          placeholder="Display name"
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500/60 focus:outline-none"
        />
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value === 'admin' ? 'admin' : 'staff' }))}
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm text-slate-100 focus:border-orange-500/60 focus:outline-none"
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
          className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="min-h-11 rounded-xl bg-orange-500 px-5 text-sm font-semibold text-slate-950 transition disabled:opacity-40 sm:col-span-2"
        >
          {create.isPending ? 'Creating…' : 'Add account'}
        </button>
      </form>

      {create.error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{String(create.error.message)}</div>
      )}
      {notice && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
    </section>
  )
}
