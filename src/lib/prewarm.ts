/**
 * Fire-and-forget pings that boot the API lambdas before they're needed —
 * free-tier cold starts are 2-3s, and a voice turn touches all three
 * endpoints. GET hits the method check (405) and exits immediately; the
 * cold-start cost (bundle eval) is paid during page load / call opening
 * instead of mid-conversation.
 */
const ENDPOINTS = ['/api/chat', '/api/voice/stt', '/api/voice/tts']

let lastWarm = 0

export function prewarmApi(): void {
  const now = Date.now()
  if (now - lastWarm < 60_000) return // recently warmed — don't spam
  lastWarm = now
  for (const path of ENDPOINTS) {
    void fetch(path, { method: 'GET' }).catch(() => {})
  }
}
