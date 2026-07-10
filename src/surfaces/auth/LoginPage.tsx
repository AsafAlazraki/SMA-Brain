import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

export default function LoginPage() {
  const { loading, session, isMockMode, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (isMockMode || session) return <Navigate to="/chat" replace />
  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Waking the brain…</div>
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const failure = await signIn(email.trim(), password)
    if (failure) {
      setError(failure)
      setBusy(false)
    }
    // on success the session lands via onAuthStateChange and the <Navigate> above kicks in
  }

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-orange-400">Tony's Brain</h1>
          <p className="mt-1 text-sm text-slate-500">Sewing Machines Australia — staff sign-in</p>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              autoFocus
              className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-500/60 focus:outline-none"
              placeholder="you@sewingmachinesaustralia.com.au"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm text-slate-100 focus:border-orange-500/60 focus:outline-none"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="min-h-11 w-full rounded-xl bg-orange-500 px-5 text-sm font-semibold text-slate-950 transition disabled:opacity-40"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-600">
          No self-signup — accounts are created by your admin. Locked out? Ask Tony.
        </p>
      </div>
    </div>
  )
}
