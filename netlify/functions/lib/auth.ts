import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
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

// Supabase signs access tokens with ES256; the public keys live at the JWKS
// endpoint. jose caches keys in-process, so warm invocations verify with ZERO
// network hops — vs the two ~200ms cross-region round-trips (auth.getUser +
// profiles select) the old path paid on EVERY request.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function remoteJwks() {
  jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  return jwks
}

type SupabaseClaims = {
  sub?: string
  email?: string
  app_metadata?: { role?: string }
  user_metadata?: { display_name?: string }
}

/**
 * Verify the caller's Supabase JWT locally (signature + expiry + audience) and
 * read the role from its claims. Every /api/* function calls this (or
 * requireAdmin) before doing anything. RLS remains the security boundary for
 * direct-to-Supabase reads; this guards the service-role paths functions use.
 * Note: a role change lands on the user's next token refresh (≤1h) — invite
 * paths set app_metadata.role at creation, so claims are authoritative.
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

  let claims: SupabaseClaims
  try {
    const { payload } = await jwtVerify(token, remoteJwks(), { audience: 'authenticated' })
    claims = payload as SupabaseClaims
  } catch {
    return { failure: jsonResponse(401, { error: 'Session expired — please sign in again' }) }
  }
  if (!claims.sub) return { failure: jsonResponse(401, { error: 'Session expired — please sign in again' }) }

  const claimRole = claims.app_metadata?.role
  if (claimRole === 'admin' || claimRole === 'staff') {
    return {
      user: {
        id: claims.sub,
        email: claims.email ?? null,
        role: claimRole,
        displayName: claims.user_metadata?.display_name ?? '',
      },
    }
  }

  // Legacy tokens without a role claim: fall back to the profiles table.
  const { data: profile, error: profileError } = await serviceClient()
    .from('profiles')
    .select('role, display_name')
    .eq('user_id', claims.sub)
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
      id: claims.sub,
      email: claims.email ?? null,
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
