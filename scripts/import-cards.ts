/**
 * Import QC'd knowledge cards (JSON arrays of {title, content, tags,
 * visibility}) into knowledge_entries as approved seed cards.
 * Usage: npm run import:cards -- <dir-or-file> [...more]
 * Idempotent by exact title (same convention as seed-knowledge.ts).
 */
import './lib/load-env'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

type Card = { title: string; content: string; tags?: string[]; visibility?: string }

function collectFiles(paths: string[]): string[] {
  const files: string[] = []
  for (const p of paths) {
    const stat = statSync(p)
    if (stat.isDirectory()) {
      files.push(...readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f)))
    } else if (p.endsWith('.json')) {
      files.push(p)
    }
  }
  return files
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: npm run import:cards -- <dir-or-file.json> [...]')
    process.exit(1)
  }
  const files = collectFiles(args)
  let inserted = 0
  let skipped = 0
  let invalid = 0
  for (const file of files) {
    let cards: Card[]
    try {
      cards = JSON.parse(readFileSync(file, 'utf8')) as Card[]
      if (!Array.isArray(cards)) throw new Error('not an array')
    } catch (err) {
      console.warn(`! ${file}: unreadable (${String(err)})`)
      continue
    }
    for (const card of cards) {
      const title = card.title?.trim().slice(0, 200)
      const content = card.content?.trim()
      if (!title || !content) {
        invalid++
        continue
      }
      const { data: existing } = await db.from('knowledge_entries').select('id').eq('title', title).maybeSingle()
      if (existing) {
        skipped++
        continue
      }
      const { error } = await db.from('knowledge_entries').insert({
        title,
        content,
        tags: (card.tags ?? []).slice(0, 8),
        visibility: card.visibility === 'public' ? 'public' : 'internal',
        status: 'approved',
        source: 'seed',
      })
      if (error) console.warn(`! ${title}: ${error.message}`)
      else inserted++
    }
    console.log(`✓ ${file}`)
  }
  console.log(`\nImported ${inserted} cards (${skipped} already present, ${invalid} invalid) from ${files.length} files.`)
}

void main()
