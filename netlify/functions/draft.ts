import type { Config } from '@netlify/functions'
import { createSSE, jsonResponse, startKeepalive } from './lib/sse'
import { runAgent } from './lib/anthropic'
import { authenticate } from './lib/auth'
import { identityLayer, groundingLayer, modeLayer, styleLayer } from './lib/prompts/system'

/** Very light thread cleanup: drop quoted history and signatures before mining. */
export function cleanEmailThread(raw: string): string {
  const lines = raw.split('\n')
  const cut = lines.findIndex(
    (l) => /^On .+ wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) || /^From:\s.+$/.test(l.trim()),
  )
  const body = (cut === -1 ? lines : lines.slice(0, cut)).join('\n')
  return body.replace(/(\n--\s*\n[\s\S]*$)/, '').trim()
}

/** Cheap question miner for v1/mock — S5 upgrades this to a fast-model pass. */
export function mineQuestions(email: string): string[] {
  const qs = email
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith('?'))
    .slice(0, 5)
  return qs.length > 0 ? qs : []
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure

  let body: { customerEmail?: string; notes?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
  const raw = (body.customerEmail ?? '').trim()
  if (!raw) return jsonResponse(400, { error: 'customerEmail required' })

  const cleaned = cleanEmailThread(raw)
  const questions = mineQuestions(cleaned)
  const sse = createSSE()

  void (async () => {
    sse.send('meta', { draftId: crypto.randomUUID() })
    sse.send('mined', { questions })
    const stopKeepalive = startKeepalive(sse)
    try {
      await runAgent({
        system: [identityLayer(), groundingLayer(), modeLayer('draft'), styleLayer(null)].join('\n\n'),
        effort: 'medium',
        messages: [
          {
            role: 'user',
            content: `Draft a reply to this customer email:\n\n---\n${cleaned}\n---${body.notes ? `\n\nStaff notes: ${body.notes}` : ''}`,
          },
        ],
        events: {
          onToken: (text) => sse.send('token', { text }),
          onTool: (name, status, summary) => sse.send('tool', { name, status, summary }),
          onProductCard: () => {},
          onGap: (question) => sse.send('gap', { question }),
          onCitations: (entries) => sse.send('citations', { entries }),
        },
      })
      sse.send('done', {})
    } catch (err) {
      sse.send('error', { message: String(err) })
    } finally {
      stopKeepalive()
      sse.close()
    }
  })()

  return sse.response
}

export const config: Config = { path: '/api/draft' }
