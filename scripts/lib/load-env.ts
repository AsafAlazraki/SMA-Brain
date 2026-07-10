/**
 * Side-effect .env loader for scripts and integration tests (tsx/vitest don't
 * read .env themselves). Real environment variables always win; no overrides.
 * Import it FIRST — modules like netlify/functions/lib/env.ts snapshot
 * process.env at import time.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadDotenv(dir = process.cwd()): void {
  let raw: string
  try {
    raw = readFileSync(join(dir, '.env'), 'utf8')
  } catch {
    return // no .env — mock mode
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key!] !== undefined) continue
    let value = rawValue ?? ''
    // quoted values first: take the quoted span, drop anything after the closing quote
    const quoted = /^"([^"]*)"/.exec(value) ?? /^'([^']*)'/.exec(value)
    if (quoted) {
      value = quoted[1]!
    } else {
      const hash = value.search(/\s#/)
      if (hash !== -1) value = value.slice(0, hash).trimEnd()
    }
    process.env[key!] = value
  }
}

loadDotenv()
