/**
 * Emit the STT vocabulary list (docs/03 S2): brand/model/needle-system terms
 * from the live products table + curated trade terms. Consumed by the
 * realtime voice stage (keyword boosting) and useful for jargon-repair evals.
 * Usage: npm run build:vocab   → writes data/stt-vocab.json
 */
import './lib/load-env'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CURATED = [
  // needle systems & sizes
  '135x17', '135x16', '135x5', 'DBx1', 'DPx5', 'DPx17', '794', '190', '16x231', 'DCx27', 'UY128GAS',
  // thread
  'Tex 70', 'Tex 90', 'Tex 92', 'Tex 135', 'V69', 'V92', 'V138', 'V207', 'bonded polyester', 'bonded nylon', 'PTFE', 'Tenara',
  // machine trade terms
  'walking foot', 'compound feed', 'overlocker', 'coverstitch', 'bartack', 'bartacker', 'blind hemmer',
  'lockstitch', 'chainstitch', 'zigzag', 'cylinder bed', 'post bed', 'flatbed', 'long arm', 'bag closer',
  'bobbin', 'hook timing', 'servo motor', 'clutch motor', 'presser foot', 'feed dog', 'needle plate',
]

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const terms = new Set<string>(CURATED)

  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } })
    const { data } = await db.from('products').select('brand, model, sku').eq('status', 'active').limit(2000)
    for (const p of data ?? []) {
      if (p.brand) terms.add(String(p.brand))
      if (p.model) terms.add(String(p.model))
      if (p.sku) terms.add(String(p.sku))
    }
  } else {
    console.warn('No Supabase env — writing curated terms only.')
  }

  const out = [...terms].filter(Boolean).sort()
  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(join(process.cwd(), 'data', 'stt-vocab.json'), JSON.stringify(out, null, 2))
  console.log(`Wrote data/stt-vocab.json with ${out.length} terms.`)
}

void main()
