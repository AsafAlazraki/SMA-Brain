import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the /api auth middleware. env.ts snapshots process.env at
 * import time, so each case stubs env vars and re-imports a fresh module.
 * The valid-token path needs a real database — covered in rls/api-guard
 * integration tests against the local Supabase stack.
 */

const SUPABASE_VARS = ['VITE_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function importAuth() {
  vi.resetModules()
  return await import('../auth')
}

describe('auth middleware — mock mode (no Supabase configured)', () => {
  it('lets requests through as the demo admin so the zero-key demo works', async () => {
    for (const key of SUPABASE_VARS) vi.stubEnv(key, '')
    const { authenticate } = await importAuth()
    const result = await authenticate(new Request('http://local/api/chat', { method: 'POST' }))
    expect(result.failure).toBeUndefined()
    expect(result.user?.role).toBe('admin')
  })

  it('requireAdmin also passes in mock mode', async () => {
    for (const key of SUPABASE_VARS) vi.stubEnv(key, '')
    const { requireAdmin } = await importAuth()
    const result = await requireAdmin(new Request('http://local/api/admin/users'))
    expect(result.failure).toBeUndefined()
    expect(result.user?.role).toBe('admin')
  })
})

describe('auth middleware — partial Supabase configuration fails closed', () => {
  it('URL without service key → 500, never the mock admin', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const { authenticate } = await importAuth()
    const result = await authenticate(new Request('http://local/api/chat', { method: 'POST' }))
    expect(result.user).toBeUndefined()
    expect(result.failure?.status).toBe(500)
  })

  it('service key without URL → 500, never the mock admin', async () => {
    for (const key of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) vi.stubEnv(key, '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'stray-service-key')
    const { authenticate } = await importAuth()
    const result = await authenticate(new Request('http://local/api/chat', { method: 'POST' }))
    expect(result.failure?.status).toBe(500)
  })
})

describe('auth middleware — Supabase configured', () => {
  function stubConfigured() {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unit-test-service-key')
  }

  it('rejects a request with no Authorization header (401, no network call)', async () => {
    stubConfigured()
    const { authenticate } = await importAuth()
    const result = await authenticate(new Request('http://local/api/chat', { method: 'POST' }))
    expect(result.user).toBeUndefined()
    expect(result.failure?.status).toBe(401)
  })

  it('rejects a non-Bearer Authorization header (401)', async () => {
    stubConfigured()
    const { authenticate } = await importAuth()
    const req = new Request('http://local/api/chat', { method: 'POST', headers: { Authorization: 'Basic dXNlcjpwdw==' } })
    const result = await authenticate(req)
    expect(result.failure?.status).toBe(401)
  })
})
