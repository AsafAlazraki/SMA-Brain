import '../../../../scripts/lib/load-env'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * End-to-end guard tests: invoke the Netlify function handlers directly with
 * real Supabase JWTs (S1 acceptance: staff cannot call admin endpoints).
 * Skipped when .env has no Supabase keys — mock mode stays green.
 */

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''
// localhost only: these tests create and delete real auth users — never point them at a hosted project
const configured = Boolean(url && serviceKey && anonKey) && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)

type Handler = (req: Request) => Promise<Response>

describe.skipIf(!configured)('/api/* auth guards (local Supabase)', () => {
  // created in beforeAll — the describe body runs at collection time even when skipped
  let service: SupabaseClient
  let chatHandler: Handler
  let adminUsersHandler: Handler
  let adminToken = ''
  let staffToken = ''
  const createdUserIds: string[] = []

  async function makeUserToken(role: 'admin' | 'staff'): Promise<string> {
    const email = `guard-${role}-${crypto.randomUUID().slice(0, 8)}@test.local`
    const password = 'Guard!TestPass1'
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { display_name: `guard ${role}` },
    })
    if (error) throw new Error(error.message)
    createdUserIds.push(data.user.id)
    // mirror the production invite path: explicit role set (trigger defaults to staff)
    const { error: roleError } = await service.from('profiles').update({ role }).eq('user_id', data.user.id)
    if (roleError) throw new Error(roleError.message)
    const client = createClient(url, anonKey, { auth: { persistSession: false } })
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError || !signIn.session) throw new Error(signInError?.message ?? 'no session')
    return signIn.session.access_token
  }

  beforeAll(async () => {
    service = createClient(url, serviceKey, { auth: { persistSession: false } })
    // load-env ran first, so these imports see the local Supabase env (env.ts snapshots at import)
    ;({ default: chatHandler } = await import('../../chat'))
    ;({ default: adminUsersHandler } = await import('../../admin-users'))
    adminToken = await makeUserToken('admin')
    staffToken = await makeUserToken('staff')
  }, 30_000)

  afterAll(async () => {
    for (const id of createdUserIds) {
      const { error } = await service.auth.admin.deleteUser(id)
      expect(error, `cleanup: deleteUser(${id}) failed: ${error?.message}`).toBeNull()
    }
  }, 30_000)

  function post(path: string, body: unknown, token?: string): Request {
    return new Request(`http://local${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
  }

  it('chat: 401 without a token', async () => {
    const res = await chatHandler(post('/api/chat', { message: 'hi' }))
    expect(res.status).toBe(401)
  })

  it('chat: 401 with a garbage token', async () => {
    const res = await chatHandler(post('/api/chat', { message: 'hi' }, 'not-a-real-jwt'))
    expect(res.status).toBe(401)
  })

  it('chat: streams SSE for a signed-in staff member', async () => {
    const res = await chatHandler(post('/api/chat', { message: 'what needle system does the LU-2810 take?' }, staffToken))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    await res.body?.cancel()
  })

  it('admin users: staff get 403, admin gets the list', async () => {
    const forbidden = await adminUsersHandler(
      new Request('http://local/api/admin/users', { headers: { Authorization: `Bearer ${staffToken}` } }),
    )
    expect(forbidden.status).toBe(403)

    const ok = await adminUsersHandler(
      new Request('http://local/api/admin/users', { headers: { Authorization: `Bearer ${adminToken}` } }),
    )
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { users: Array<{ id: string }> }
    expect(Array.isArray(body.users)).toBe(true)
    expect(body.users.length).toBeGreaterThanOrEqual(2)
  })

  it('invite-only round trip: admin creates an account, that account can sign in as staff', async () => {
    const email = `invited-${crypto.randomUUID().slice(0, 8)}@test.local`
    const res = await adminUsersHandler(
      post('/api/admin/users', { email, password: 'Invited!Pass1', role: 'staff', displayName: 'Invited Staffer' }, adminToken),
    )
    expect(res.status).toBe(201)
    const { user } = (await res.json()) as { user: { id: string; role: string } }
    createdUserIds.push(user.id)
    expect(user.role).toBe('staff')

    const client = createClient(url, anonKey, { auth: { persistSession: false } })
    const { data, error } = await client.auth.signInWithPassword({ email, password: 'Invited!Pass1' })
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()

    const { data: profile } = await service.from('profiles').select('role, display_name').eq('user_id', user.id).single()
    expect(profile).toMatchObject({ role: 'staff', display_name: 'Invited Staffer' })
  })

  it('staff cannot create accounts (403 before any work happens)', async () => {
    const res = await adminUsersHandler(
      post('/api/admin/users', { email: 'sneaky@test.local', password: 'Sneaky!Pass1', role: 'admin' }, staffToken),
    )
    expect(res.status).toBe(403)
  })
})
