import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from './lib/auth'

export default function App() {
  const { profile, isMockMode, signOut } = useAuth()

  const tabs = [
    { to: '/chat', label: 'Ask' },
    { to: '/draft', label: 'Draft' },
    ...(profile?.role === 'admin' ? [{ to: '/admin', label: 'Admin' }] : []),
  ]

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-orange-400">Tony's Brain</span>
          <span className="hidden text-xs text-slate-500 sm:inline">Sewing Machines Australia</span>
        </div>
        <div className="flex items-center gap-1">
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `rounded-lg px-4 py-2 text-sm font-medium transition min-h-11 flex items-center ${
                    isActive ? 'bg-orange-500/15 text-orange-300' : 'text-slate-400 hover:text-slate-200'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          {!isMockMode && (
            <button
              onClick={() => void signOut()}
              title={profile ? `Signed in as ${profile.displayName || 'you'} — sign out` : 'Sign out'}
              className="ml-1 flex min-h-11 items-center rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:text-slate-200"
            >
              <span className="mr-1.5 hidden max-w-32 truncate text-xs text-slate-500 md:inline">{profile?.displayName}</span>
              Sign out
            </button>
          )}
        </div>
      </header>
      {isMockMode && (
        <div className="border-b border-amber-900/50 bg-amber-950/40 px-4 py-1.5 text-xs text-amber-300">
          Local dev mode — Supabase not configured; running against mock brain. See README → Local setup.
        </div>
      )}
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
