/**
 * Seed the Brain from docs/knowledge/*.md — S2 upgrades this with fast-model chunking.
 * v0: splits corpus docs on `## ` headings into atomic-ish cards, tags by filename,
 * inserts as approved seed cards (embeddings backfilled in S3).
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
 * (local stack: supabase start prints the URL + service_role key)
 */
import './lib/load-env'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see `supabase start` output).')
  process.exit(1)
}
const db = createClient(url, key)

const KNOWLEDGE_DIR = join(process.cwd(), 'docs', 'knowledge')
const VISIBILITY_DEFAULT: Record<string, 'internal' | 'public'> = {
  'sma-company-profile.md': 'internal',
  'sma-knowledge-brief.md': 'internal',
  'au-industry-map.md': 'internal',
  'customers-knowledge-domain.md': 'public',
}

async function main() {
  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'))
  let inserted = 0
  for (const file of files) {
    const raw = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8')
    const tag = file.replace('.md', '')
    const visibility = VISIBILITY_DEFAULT[file] ?? 'internal'
    const sections = raw.split(/\n(?=## )/g)
    for (const section of sections) {
      const heading = /^#{1,2}\s+(.+)$/m.exec(section)?.[1]?.trim()
      const content = section.trim()
      if (!heading || content.length < 200) continue
      const title = `${heading} (${tag})`.slice(0, 200)
      // idempotent: skip if a card with this title already exists
      const { data: existing } = await db.from('knowledge_entries').select('id').eq('title', title).maybeSingle()
      if (existing) continue
      const { error } = await db.from('knowledge_entries').insert({
        title,
        content,
        tags: ['seed', tag],
        visibility,
        status: 'approved',
        source: 'seed',
      })
      if (error) console.warn(`  ! ${title}: ${error.message}`)
      else inserted++
    }
    console.log(`✓ ${file}`)
  }
  console.log(`Seeded ~${inserted} cards from ${files.length} corpus docs.`)
}

void main()
