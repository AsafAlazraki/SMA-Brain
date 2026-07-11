/**
 * Seed the first accounts — the system is invite-only (no self-signup), so an
 * admin and a staff login have to exist before anyone can use the app.
 * Role goes in app_metadata (service-role only); the 0002 trigger builds the
 * profiles row from it. Idempotent: existing emails are skipped.
 *
 * Usage: npm run seed:users   (reads .env; override SEED_* vars to customise)
 */
import './lib/load-env'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (see `supabase start` output).')
  process.exit(1)
}

// The committed default passwords are for the LOCAL stack only — refuse to plant a
// publicly-known admin password on any real project.
const isLocalTarget = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)
if (!isLocalTarget && !(process.env.SEED_ADMIN_PASSWORD && process.env.SEED_STAFF_PASSWORD)) {
  console.error(`Target ${url} is not a local stack — set SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD explicitly (no committed defaults beyond localhost).`)
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

// `||` not `??`: blank SEED_* lines in a copied .env mean "use the default"
const ACCOUNTS = [
  {
    email: process.env.SEED_ADMIN_EMAIL || 'tony@sma.local',
    password: process.env.SEED_ADMIN_PASSWORD || 'TonysBrain!2026',
    role: 'admin' as const,
    displayName: process.env.SEED_ADMIN_NAME || 'Tony',
  },
  {
    email: process.env.SEED_STAFF_EMAIL || 'staff@sma.local',
    password: process.env.SEED_STAFF_PASSWORD || 'SmaStaff!2026',
    role: 'staff' as const,
    displayName: process.env.SEED_STAFF_NAME || 'Staff Test',
  },
]

async function main() {
  for (const account of ACCOUNTS) {
    const { data, error } = await db.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      app_metadata: { role: account.role },
      user_metadata: { display_name: account.displayName },
    })
    if (error) {
      if (/already/i.test(error.message)) {
        console.log(`= ${account.email} already exists — skipped`)
        continue
      }
      console.error(`! ${account.email}: ${error.message}`)
      process.exitCode = 1
      continue
    }
    // GoTrue merges app_metadata after the insert, so the trigger defaults the profile
    // to staff — set the role explicitly (same as /api/admin/users does).
    const { error: roleError } = await db
      .from('profiles')
      .update({ role: account.role, display_name: account.displayName })
      .eq('user_id', data.user.id)
    if (roleError) {
      console.error(`! ${account.email}: profile role assignment failed: ${roleError.message}`)
      process.exitCode = 1
      continue
    }
    const { data: profile } = await db.from('profiles').select('role').eq('user_id', data.user.id).maybeSingle()
    console.log(`✓ ${account.email} created (${account.role}; profile role: ${profile?.role ?? 'MISSING — check 0002 trigger'})`)
  }
  console.log('\nLocal sign-ins:')
  for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(5)} ${a.email} / ${a.password}`)
  console.log('\nThese are local-dev defaults — set SEED_* env vars for anything beyond your machine.')
}

void main()
