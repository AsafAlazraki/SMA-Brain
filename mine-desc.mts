import './scripts/lib/load-env'
import { createClient } from '@supabase/supabase-js'
import { runDescriptionMining } from './netlify/functions/lib/research'

const svc = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { data: admin } = await svc.from('profiles').select('user_id').eq('role', 'admin').limit(1).single()

const before = await svc.from('knowledge_entries').select('*', { count: 'exact', head: true }).eq('status', 'approved')
console.log(`approved cards before: ${before.count}`)
console.log('mining product descriptions into grounded cards (verified, auto-published)…\n')

const t0 = Date.now()
const out = await runDescriptionMining({ adminId: admin!.user_id as string, limit: 40 })
console.log(`\n=== DESCRIPTION MINING DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s ===`)
console.log(`auto-approve: ${out.autoApprove} | processed ${out.processed} products`)
console.log(`published live: ${out.totalLive} | queued: ${out.totalQueued} | skipped (already covered): ${out.skipped}`)

const after = await svc.from('knowledge_entries').select('*', { count: 'exact', head: true }).eq('status', 'approved')
console.log(`approved cards after: ${after.count} (was ${before.count})`)

console.log('\n=== SAMPLE cards from product descriptions ===')
const { data: samples } = await svc
  .from('knowledge_entries')
  .select('title, content, provenance')
  .is('approved_by', null)
  .eq('source', 'catalog')
  .contains('provenance', { source_kind: 'description' })
  .order('created_at', { ascending: false })
  .limit(5)
for (const s of samples ?? []) console.log(`\n• ${s.title}\n  ${String(s.content).slice(0, 190)}`)
