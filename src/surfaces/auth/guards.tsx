import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

/** Route guards are UX only — RLS and the /api middleware are the security boundary. */

export function RequireAuth() {
  const { loading, session, profile, profileError, isMockMode, retryProfile, signOut } = useAuth()
  if (isMockMode) return <Outlet />
  if (loading) {
    return (
      <FullScreen>
        <span className="lamp" />
        <span className="stamp !text-cloth-400">Waking the brain…</span>
      </FullScreen>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (profileError) {
    return (
      <FullScreen column>
        <p className="text-sm text-cloth-400">Couldn't reach the brain — check your connection and try again.</p>
        <button onClick={retryProfile} className="btn-safety display mt-4 min-h-11 px-6 text-lg tracking-wide">
          Retry
        </button>
      </FullScreen>
    )
  }
  if (!profile) {
    return (
      <FullScreen column>
        <p className="text-sm text-cloth-400">Your account has no profile yet — ask an admin to set you up.</p>
        <button
          onClick={() => void signOut()}
          className="stamp mt-4 min-h-11 rounded border border-steel-600 px-5 !text-cloth-400 transition hover:border-safety-500/60 hover:!text-cloth-100"
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

function FullScreen({ children, column }: { children: React.ReactNode; column?: boolean }) {
  return (
    <div className={`flex h-full items-center justify-center gap-3 px-6 text-center ${column ? 'flex-col' : ''}`}>
      {children}
    </div>
  )
}
