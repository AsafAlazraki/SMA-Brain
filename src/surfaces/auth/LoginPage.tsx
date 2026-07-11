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
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <span className="lamp" />
        <span className="stamp !text-cloth-400">Waking the brain…</span>
      </div>
    )
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
    <div className="relative flex h-full items-center justify-center px-4">
      {/* ruler ticks — workshop flourish, desktop only */}
      <div className="ruler-y absolute inset-y-8 left-4 hidden w-4 md:block" aria-hidden />
      <div className="ruler-y absolute inset-y-8 right-4 hidden w-4 scale-x-[-1] md:block" aria-hidden />

      <div className="w-full max-w-sm pb-10">
        <div className="rise mb-2 text-center">
          <h1 className="display text-[44px] leading-none text-cloth-100">
            Tony's <span className="text-safety-500">Brain</span>
          </h1>
        </div>
        <p className="rise rise-1 stamp mb-8 text-center !text-cloth-400">
          Sewing Machines Australia — staff sign-in
        </p>

        <div className="rise rise-2 seam mb-0" aria-hidden />
        <form onSubmit={(e) => void submit(e)} className="rise rise-2 plate space-y-4 rounded-b-md p-5">
          <label className="block">
            <span className="stamp mb-1.5 block !text-cloth-400">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              autoFocus
              className="field min-h-12 w-full px-4 text-[15px]"
              placeholder="you@sewingmachinesaustralia.com.au"
            />
          </label>
          <label className="block">
            <span className="stamp mb-1.5 block !text-cloth-400">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="field min-h-12 w-full px-4 text-[15px]"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="rounded border border-stop-500/40 bg-stop-500/10 px-3 py-2 text-sm text-stop-500">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="btn-safety display min-h-12 w-full text-lg tracking-wide"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="rise rise-3 stamp mt-6 text-center">
          No self-signup — accounts are created by your admin. Locked out? Ask Tony.
        </p>
      </div>
    </div>
  )
}
