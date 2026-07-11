import '../../../../scripts/lib/load-env'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * RLS policy tests against the LOCAL Supabase stack (S1 acceptance criteria).
 * Skipped automatically when .env has no Supabase keys — `npm test` stays
 * green in mock mode. Run `npx supabase start` + fill .env to enable.
 */

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''
// localhost only: these tests create and delete real auth users — never point them at a hosted project
const configured = Boolean(url && serviceKey && anonKey) && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)

type TestUser = { id: string; email: string; client: SupabaseClient }

describe.skipIf(!configured)('RLS policies (staff vs admin fixtures, local Supabase)', () => {
  // created in beforeAll — the describe body runs at collection time even when skipped
  let service: SupabaseClient
  let admin: TestUser
  let staff1: TestUser
  let staff2: TestUser
  const createdUserIds: string[] = []
  const createdEntryIds: string[] = []

  async function makeUser(role: 'admin' | 'staff', name: string): Promise<TestUser> {
    const email = `rls-${name}-${crypto.randomUUID().slice(0, 8)}@test.local`
    const password = 'Rls!TestPass1'
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { display_name: name },
    })
    if (error) throw new Error(`createUser(${name}): ${error.message}`)
    createdUserIds.push(data.user.id)
    // GoTrue merges app_metadata after the insert, so the 0002 trigger defaults the
    // profile to staff — production invite paths set the role explicitly; mirror that.
    const { error: roleError } = await service
      .from('profiles')
      .update({ role, display_name: name })
      .eq('user_id', data.user.id)
    if (roleError) throw new Error(`set role(${name}): ${roleError.message}`)
    const client = createClient(url, anonKey, { auth: { persistSession: false } })
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`signIn(${name}): ${signInError.message}`)
    return { id: data.user.id, email, client }
  }

  beforeAll(async () => {
    service = createClient(url, serviceKey, { auth: { persistSession: false } })
    admin = await makeUser('admin', 'admin')
    staff1 = await makeUser('staff', 'staff1')
    staff2 = await makeUser('staff', 'staff2')
  }, 30_000)

  afterAll(async () => {
    for (const id of createdEntryIds) await service.from('knowledge_entries').delete().eq('id', id)
    await service.from('usage_events').delete().eq('kind', 'rls_test')
    // learning_queue.created_by/reviewed_by have no ON DELETE action — clear rows
    // BEFORE deleting users or GoTrue's hard delete hits the FK and leaves zombies
    await service.from('learning_queue').delete().eq('proposed_title', 'RLS test proposal')
    for (const id of createdUserIds) {
      const { error } = await service.auth.admin.deleteUser(id)
      expect(error, `cleanup: deleteUser(${id}) failed: ${error?.message}`).toBeNull()
    }
  }, 30_000)

  it('0002 trigger auto-creates a profile row; explicit role set (the invite path) sticks', async () => {
    // the trigger guarantees the row exists (default staff — GoTrue merges app_metadata
    // post-insert); the explicit update in makeUser mirrors /api/admin/users
    const { data: adminProfile } = await service.from('profiles').select('role, display_name').eq('user_id', admin.id).single()
    expect(adminProfile).toMatchObject({ role: 'admin', display_name: 'admin' })
    const { data: staffProfile } = await service.from('profiles').select('role').eq('user_id', staff1.id).single()
    expect(staffProfile?.role).toBe('staff')
  })

  it('profiles: staff read only their own row; admin reads all', async () => {
    const { data: own } = await staff1.client.from('profiles').select('user_id').eq('user_id', staff1.id)
    expect(own).toHaveLength(1)
    const { data: other } = await staff1.client.from('profiles').select('user_id').eq('user_id', admin.id)
    expect(other).toHaveLength(0)
    const { data: all } = await admin.client.from('profiles').select('user_id').in('user_id', [admin.id, staff1.id, staff2.id])
    expect(all).toHaveLength(3)
  })

  it('profiles: staff can update their display name but cannot escalate their role', async () => {
    const { error: nameError } = await staff1.client
      .from('profiles')
      .update({ display_name: 'staff1 renamed' })
      .eq('user_id', staff1.id)
    expect(nameError).toBeNull()

    const { error: escalation } = await staff1.client.from('profiles').update({ role: 'admin' }).eq('user_id', staff1.id)
    expect(escalation).not.toBeNull()
    const { data: after } = await service.from('profiles').select('role').eq('user_id', staff1.id).single()
    expect(after?.role).toBe('staff')
  })

  it('knowledge_entries: staff see approved only; admin sees drafts too; only admin writes', async () => {
    const { data: approved } = await service
      .from('knowledge_entries')
      .insert({ title: 'RLS test — approved card', content: 'staff should see this', status: 'approved', source: 'manual' })
      .select('id')
      .single()
    const { data: draft } = await service
      .from('knowledge_entries')
      .insert({ title: 'RLS test — draft card', content: 'staff should NOT see this', status: 'draft', source: 'manual' })
      .select('id')
      .single()
    createdEntryIds.push(approved!.id, draft!.id)

    const { data: staffSees } = await staff1.client.from('knowledge_entries').select('id').in('id', [approved!.id, draft!.id])
    expect(staffSees?.map((r) => r.id)).toEqual([approved!.id])

    const { data: adminSees } = await admin.client.from('knowledge_entries').select('id').in('id', [approved!.id, draft!.id])
    expect(adminSees).toHaveLength(2)

    const { error: staffInsert } = await staff1.client
      .from('knowledge_entries')
      .insert({ title: 'staff freelancing', content: 'should be blocked' })
    expect(staffInsert).not.toBeNull()

    const { data: adminInsert, error: adminInsertError } = await admin.client
      .from('knowledge_entries')
      .insert({ title: 'RLS test — admin authored', content: 'admins may write directly', status: 'approved', source: 'manual' })
      .select('id')
      .single()
    expect(adminInsertError).toBeNull()
    createdEntryIds.push(adminInsert!.id)
  })

  it('conversations & messages: private to their owner; admin can read', async () => {
    const { data: conv, error: convError } = await staff1.client
      .from('conversations')
      .insert({ user_id: staff1.id, mode: 'chat', title: 'RLS test conversation' })
      .select('id')
      .single()
    expect(convError).toBeNull()

    const { error: msgError } = await staff1.client
      .from('messages')
      .insert({ conversation_id: conv!.id, role: 'user', content: 'mine' })
    expect(msgError).toBeNull()

    const { data: spy } = await staff2.client.from('conversations').select('id').eq('id', conv!.id)
    expect(spy).toHaveLength(0)
    const { error: plant } = await staff2.client
      .from('messages')
      .insert({ conversation_id: conv!.id, role: 'user', content: 'not mine' })
    expect(plant).not.toBeNull()

    const { data: adminView } = await admin.client.from('conversations').select('id').eq('id', conv!.id)
    expect(adminView).toHaveLength(1)
  })

  it('app_settings: staff read but cannot write; admin writes', async () => {
    const { data: read } = await staff1.client.from('app_settings').select('self_learning_enabled').eq('id', 1)
    expect(read).toHaveLength(1)

    const { data: staffWrite } = await staff1.client
      .from('app_settings')
      .update({ self_learning_enabled: read![0]!.self_learning_enabled })
      .eq('id', 1)
      .select('id')
    expect(staffWrite).toHaveLength(0) // row invisible to the USING clause — nothing updated

    const { data: adminWrite } = await admin.client
      .from('app_settings')
      .update({ self_learning_enabled: read![0]!.self_learning_enabled })
      .eq('id', 1)
      .select('id')
    expect(adminWrite).toHaveLength(1)
  })

  it('usage_events: admin-only reads', async () => {
    await service.from('usage_events').insert({ kind: 'rls_test', tokens_in: 1, tokens_out: 1 })
    const { data: staffView } = await staff1.client.from('usage_events').select('id').eq('kind', 'rls_test')
    expect(staffView).toHaveLength(0)
    const { data: adminView } = await admin.client.from('usage_events').select('id').eq('kind', 'rls_test')
    expect(adminView!.length).toBeGreaterThan(0)
  })

  it('learning_queue: staff propose and read their own; only admin reviews', async () => {
    const { data: proposal, error: proposeError } = await staff1.client
      .from('learning_queue')
      .insert({
        proposed_title: 'RLS test proposal',
        proposed_content: 'staff suggestion',
        source_type: 'staff_suggestion',
        created_by: staff1.id,
      })
      .select('id')
      .single()
    expect(proposeError).toBeNull()

    const { data: otherStaff } = await staff2.client.from('learning_queue').select('id').eq('id', proposal!.id)
    expect(otherStaff).toHaveLength(0)

    // provenance: staff cannot attribute a proposal to someone else (0002 tightened policy)
    const { error: spoof } = await staff2.client.from('learning_queue').insert({
      proposed_title: 'RLS test proposal',
      proposed_content: 'spoofed attribution',
      source_type: 'staff_suggestion',
      created_by: staff1.id,
    })
    expect(spoof).not.toBeNull()

    const { data: selfReview } = await staff1.client
      .from('learning_queue')
      .update({ status: 'approved' })
      .eq('id', proposal!.id)
      .select('id')
    expect(selfReview).toHaveLength(0)

    const { data: adminReview } = await admin.client
      .from('learning_queue')
      .update({ status: 'rejected', reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
      .eq('id', proposal!.id)
      .select('id')
    expect(adminReview).toHaveLength(1)
  })

  it('anon: zero access in v1 (no table grants)', async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } })
    const { error } = await anon.from('knowledge_entries').select('id').limit(1)
    expect(error).not.toBeNull()
  })
})
