import type { Config } from '@netlify/functions'
import { jsonResponse } from './lib/sse'
import { requireAdmin, serviceClient, MOCK_USER, type Role } from './lib/auth'
import { isSupabaseConfigured } from './lib/env'

type UserRow = { id: string; email: string | null; role: Role; displayName: string; createdAt: string | null }

/**
 * Invite-only user management (S1): admins list accounts and create new ones.
 * No self-signup anywhere — Supabase signup is disabled; accounts only come
 * from here (or the seed script). Role lands in app_metadata, which users
 * cannot edit, and the 0002 trigger copies it into profiles.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req)
  if (auth.failure) return auth.failure

  if (!isSupabaseConfigured) {
    if (req.method === 'GET') {
      return jsonResponse(200, {
        users: [{ id: MOCK_USER.id, email: MOCK_USER.email, role: MOCK_USER.role, displayName: MOCK_USER.displayName, createdAt: null }],
        note: 'Mock mode — connect Supabase to manage real accounts (README → Local setup).',
      })
    }
    return jsonResponse(503, { error: 'User management needs Supabase — see README → Local setup' })
  }

  if (req.method === 'GET') return listUsers()
  if (req.method === 'POST') return createUser(req)
  return jsonResponse(405, { error: 'GET or POST only' })
}

async function listUsers(): Promise<Response> {
  const service = serviceClient()
  const perPage = 200
  const allUsers = []
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage })
    if (error) return jsonResponse(500, { error: `Could not list users: ${error.message}` })
    allUsers.push(...data.users)
    if (data.users.length < perPage) break
  }

  const { data: profiles, error: profilesError } = await service.from('profiles').select('user_id, role, display_name')
  if (profilesError) return jsonResponse(500, { error: `Could not load profiles: ${profilesError.message}` })
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]))

  const users: UserRow[] = allUsers.map((u) => {
    const p = byId.get(u.id)
    return {
      id: u.id,
      email: u.email ?? null,
      role: p?.role === 'admin' ? 'admin' : 'staff',
      displayName: (p?.display_name as string) ?? '',
      createdAt: u.created_at ?? null,
    }
  })
  return jsonResponse(200, { users })
}

async function createUser(req: Request): Promise<Response> {
  let body: { email?: string; password?: string; role?: string; displayName?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const role: Role = body.role === 'admin' ? 'admin' : 'staff'
  const displayName = (body.displayName ?? '').trim()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(400, { error: 'A valid email address is required' })
  if (password.length < 8) return jsonResponse(400, { error: 'Password must be at least 8 characters' })

  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true, // invite-only: admin vouches for the address; no confirmation email round-trip
    app_metadata: { role },
    user_metadata: { display_name: displayName },
  })
  if (error) return jsonResponse(400, { error: error.message })

  return jsonResponse(201, {
    user: { id: data.user.id, email: data.user.email ?? email, role, displayName, createdAt: data.user.created_at ?? null },
  })
}

export const config: Config = { path: '/api/admin/users' }
