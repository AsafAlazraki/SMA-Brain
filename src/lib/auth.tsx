import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'

export type Role = 'admin' | 'staff'
export type Profile = { role: Role; displayName: string }

type AuthContextValue = {
  /** True only while restoring the session / loading the profile (Supabase mode). */
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** Profile fetch failed (network/outage) — distinct from "no profile row exists". */
  profileError: boolean
  /** No Supabase configured — zero-key demo runs as a pretend admin, no login. */
  isMockMode: boolean
  retryProfile: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const MOCK_PROFILE: Profile = { role: 'admin', displayName: 'Demo (mock mode)' }

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(isSupabaseConfigured ? null : MOCK_PROFILE)
  const [profileError, setProfileError] = useState(false)
  const [profileAttempt, setProfileAttempt] = useState(0)

  useEffect(() => {
    if (!supabase) return
    // Only set state here — calling supabase inside this callback can deadlock (supabase-js docs).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!supabase || !userId) return
    let cancelled = false
    setLoading(true)
    setProfileError(false)
    void supabase
      .from('profiles')
      .select('role, display_name')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // network/outage — keep the door open for a retry, don't claim "no profile"
          setProfile(null)
          setProfileError(true)
        } else {
          setProfile(data ? { role: data.role === 'admin' ? 'admin' : 'staff', displayName: data.display_name ?? '' } : null)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, profileAttempt])

  async function signIn(email: string, password: string): Promise<string | null> {
    if (!supabase) return null
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) return null
    return /invalid login credentials/i.test(error.message)
      ? 'Email or password didn’t match — check with your admin if you’re locked out.'
      : error.message
  }

  async function signOut(): Promise<void> {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        profile,
        profileError,
        isMockMode: !isSupabaseConfigured,
        retryProfile: () => setProfileAttempt((n) => n + 1),
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
