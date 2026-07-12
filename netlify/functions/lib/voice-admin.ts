import { serviceClient } from './auth'
import { isSupabaseConfigured } from './env'

/**
 * Admin actions exposed to the voice call as tools, so Tony can run the whole
 * approval loop hands-free. Mirrors AdminPage's review mutation exactly —
 * approve inserts an approved knowledge_entries row, then stamps the queue row.
 * Only ever wired up for authenticated admins (see runAgent's adminId gate);
 * guardrail 3 (queue-gated learning) holds because the admin IS the approver.
 */

// queue source_type → knowledge_entries.source (check-constrained; must match AdminPage's map)
const SOURCE_MAP: Record<string, string> = {
  teach_session: 'taught',
  blurt: 'taught',
  correction: 'correction',
  email_edit: 'email_edit',
  email_mining: 'manual',
  staff_suggestion: 'manual',
  autonomous_research: 'research',
  catalog_mining: 'catalog',
}

export type QueueSummary = { id: string; title: string; summary: string; source: string }

export async function listPendingKnowledge(): Promise<QueueSummary[]> {
  if (!isSupabaseConfigured) return []
  const { data, error } = await serviceClient()
    .from('learning_queue')
    .select('id, proposed_title, proposed_content, source_type, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.proposed_title as string,
    summary: String(r.proposed_content ?? '').slice(0, 280),
    source: SOURCE_MAP[r.source_type as string] ?? (r.source_type as string),
  }))
}

export async function reviewPendingKnowledge(
  queueId: string,
  verdict: 'approved' | 'rejected',
  adminId: string,
): Promise<{ ok: boolean; title?: string; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'no database' }
  const db = serviceClient()
  const { data: item, error } = await db
    .from('learning_queue')
    .select('id, proposed_title, proposed_content, proposed_tags, proposed_visibility, source_type, created_by, status')
    .eq('id', queueId)
    .maybeSingle()
  if (error || !item) return { ok: false, error: 'queue item not found' }
  if (item.status !== 'pending') return { ok: false, error: `already ${item.status}` }

  let resultingEntryId: string | null = null
  if (verdict === 'approved') {
    const { data: entry, error: insErr } = await db
      .from('knowledge_entries')
      .insert({
        title: item.proposed_title,
        content: item.proposed_content,
        tags: item.proposed_tags,
        visibility: item.proposed_visibility,
        status: 'approved',
        source: SOURCE_MAP[item.source_type as string] ?? 'manual',
        created_by: item.created_by,
        approved_by: adminId,
        approved_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (insErr) return { ok: false, error: insErr.message }
    resultingEntryId = entry.id as string
  }
  const { error: upErr } = await db
    .from('learning_queue')
    .update({
      status: verdict,
      resulting_entry_id: resultingEntryId,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', queueId)
  if (upErr) return { ok: false, error: upErr.message }
  return { ok: true, title: item.proposed_title as string }
}

export async function listKnowledgeGaps(): Promise<{ question: string; times_asked: number; last_asked: string }[]> {
  if (!isSupabaseConfigured) return []
  const { data, error } = await serviceClient()
    .from('knowledge_gaps')
    .select('question, times_asked, last_asked_at')
    .eq('status', 'open')
    .order('last_asked_at', { ascending: false })
    .limit(15)
  if (error) throw new Error(error.message)
  return (data ?? []).map((g) => ({
    question: g.question as string,
    times_asked: (g.times_asked as number) ?? 1,
    last_asked: String(g.last_asked_at).slice(0, 10),
  }))
}
