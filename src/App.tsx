import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { CallProvider } from './lib/call/CallProvider'
import { prewarmApi } from './lib/prewarm'

export default function App() {
  const { profile, isMockMode, signOut } = useAuth()
  useEffect(() => prewarmApi(), [])

  // Kept deliberately short — staff live in the call; these are the "look at it" surfaces.
  const tabs = [
    { to: '/chat', label: 'Ask' },
    { to: '/draft', label: 'Draft' },
    ...(profile?.role === 'admin' ? [{ to: '/admin', label: 'Admin' }] : []),
  ]

  return (
    <CallProvider>
      <div className="flex h-full flex-col">
        <header className="bg-iron-900/80 backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 pt-3 pb-2">
            <div className="min-w-0">
              <span className="display block text-xl leading-none text-cloth-100">
                Tony's <span className="text-safety-500">Brain</span>
              </span>
              <span className="stamp hidden sm:block">Sewing Machines Australia</span>
            </div>
            <div className="flex items-center gap-1">
              <nav className="flex items-center gap-1">
                {tabs.map((t) => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    className={({ isActive }) =>
                      `display flex min-h-11 items-center border-b-2 px-3 pt-1 text-[15px] tracking-wide transition sm:px-4 ${
                        isActive ? 'border-safety-500 text-safety-400' : 'border-transparent text-cloth-400 hover:text-cloth-100'
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
                  className="stamp ml-2 flex min-h-11 items-center rounded px-2 !text-cloth-600 transition hover:!text-cloth-100"
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
          <div className="seam" />
        </header>

        {isMockMode && (
          <div className="border-b border-steel-700 bg-steel-900 px-4 py-1.5">
            <p className="stamp mx-auto max-w-5xl !text-denim-400">
              Bench mode — no database connected; answers come from the demo corpus. README → Local setup.
            </p>
          </div>
        )}

        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </CallProvider>
  )
}
