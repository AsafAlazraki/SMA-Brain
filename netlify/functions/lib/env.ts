export const env = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? '',
  ANTHROPIC_MODEL_FAST: process.env.ANTHROPIC_MODEL_FAST ?? '',
  SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ?? '',
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID ?? '',
}

export const isVoiceConfigured = Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID)

/** Mock mode: no Anthropic key (or explicit MOCK_LLM=true) → canned streaming so the app runs with zero secrets. */
export const isMockLLM = process.env.MOCK_LLM === 'true' || !env.ANTHROPIC_API_KEY

export const isSupabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)

/**
 * Exactly one of URL / service key present = a broken deploy, not the zero-key demo.
 * Auth must FAIL CLOSED here — never fall back to the mock admin (see lib/auth.ts).
 */
export const isSupabasePartiallyConfigured =
  Boolean(env.SUPABASE_URL) !== Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
