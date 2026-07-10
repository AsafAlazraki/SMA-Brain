import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured, isSupabasePartiallyConfigured } from './env'
import { jsonResponse } from './sse'

export type Role = 'admin' | 'staff'
export type AuthedUser = { id: string; email: string | null; role: Role; displayName: string }

/** Zero-key demo path: with no Supabase configured the app runs as a pretend admin. */
export const MOCK_USER: AuthedUser = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'demo@sma.local',
  role: 'admin',
  displayName: 'Demo (mock mode)',
}

let service: SupabaseClient | null = null
/** Server-side Supabase client (service role). Only call when isSupabaseConfigured. */
export function serviceClient(): SupabaseClient {
  service ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return service
}

export type AuthResult = { user: AuthedUser; failure?: never } | { user?: never; failure: Response }

/**
 * Verify the caller's Supabase JWT and load their profile role.
 * Every /api/* function calls this (or requireAdmin) before doing anything.
 * RLS remains the security boundary for direct-to-Supabase reads; this guards
 * the service-role paths that functions use.
 */
export async function authenticate(req: Request): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    // Half-configured Supabase (URL without service key, or vice versa) means a broken
    // deploy — fail closed. The mock-admin path is ONLY for the true zero-key demo.
    if (isSupabasePartiallyConfigured) {
      return { failure: jsonResponse(500, { error: 'Server auth is misconfigured — Supabase env vars are incomplete' }) }
    }
    return { user: MOCK_USER }
  }

  const header = req.headers.get('authorization') ?? ''
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]
  if (!token) return { failure: jsonResponse(401, { error: 'Sign in required' }) }

  const { data, error } = await serviceClient().auth.getUser(token)
  if (error || !data.user) {
    return { failure: jsonResponse(401, { error: 'Session expired — please sign in again' }) }
  }

  const { data: profile, error: profileError } = await serviceClient()
    .from('profiles')
    .select('role, display_name')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (profileError) {
    // transient DB failure ≠ missing profile — retryable 500, not a "contact your admin" 403
    return { failure: jsonResponse(500, { error: 'Could not load your profile — try again shortly' }) }
  }
  if (!profile) {
    return { failure: jsonResponse(403, { error: 'No profile for this account — ask an admin to set you up' }) }
  }

  return {
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      role: profile.role === 'admin' ? 'admin' : 'staff',
      displayName: profile.display_name ?? '',
    },
  }
}

/** authenticate + admin check, for /api/admin/* endpoints. */
export async function requireAdmin(req: Request): Promise<AuthResult> {
  const result = await authenticate(req)
  if (result.failure) return result
  if (result.user.role !== 'admin') return { failure: jsonResponse(403, { error: 'Admin access only' }) }
  return result
}
