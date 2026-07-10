import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

/** Route guards are UX only — RLS and the /api middleware are the security boundary. */

export function RequireAuth() {
  const { loading, session, profile, profileError, isMockMode, retryProfile, signOut } = useAuth()
  if (isMockMode) return <Outlet />
  if (loading) return <FullScreen>Waking the brain…</FullScreen>
  if (!session) return <Navigate to="/login" replace />
  if (profileError) {
    return (
      <FullScreen>
        <p>Couldn't reach the brain — check your connection and try again.</p>
        <button
          onClick={retryProfile}
          className="mt-4 min-h-11 rounded-xl bg-orange-500 px-5 text-sm font-semibold text-slate-950 transition"
        >
          Retry
        </button>
      </FullScreen>
    )
  }
  if (!profile) {
    return (
      <FullScreen>
        <p>Your account has no profile yet — ask an admin to set you up.</p>
        <button
          onClick={() => void signOut()}
          className="mt-4 min-h-11 rounded-xl border border-slate-700 px-5 text-sm font-medium text-slate-300 transition hover:border-orange-500/50"
        >
          Sign out
        </button>
      </FullScreen>
    )
  }
  return <Outlet />
}

export function RequireAdmin() {
  const { profile, isMockMode } = useAuth()
  if (isMockMode) return <Outlet />
  return profile?.role === 'admin' ? <Outlet /> : <Navigate to="/chat" replace />
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-slate-400">
      {children}
    </div>
  )
}
