import type { Config } from '@netlify/functions'
import { createSSE, jsonResponse, startKeepalive } from './lib/sse'
import { runAgent } from './lib/anthropic'
import { authenticate } from './lib/auth'
import { identityLayer, groundingLayer, modeLayer } from './lib/prompts/system'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure

  let body: { conversationId?: string | null; message?: string; mode?: 'chat' | 'call' }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
  const message = (body.message ?? '').trim()
  if (!message) return jsonResponse(400, { error: 'message required' })
  const mode = body.mode === 'call' ? 'call' : 'chat'

  const sse = createSSE()
  const conversationId = body.conversationId ?? crypto.randomUUID()

  // run the agent without blocking the response
  void (async () => {
    sse.send('meta', { conversationId, messageId: crypto.randomUUID() })
    const stopKeepalive = startKeepalive(sse)
    const started = Date.now()
    try {
      await runAgent({
        system: [identityLayer(), groundingLayer(), modeLayer(mode)].join('\n\n'),
        messages: [{ role: 'user', content: message }],
        maxToolRounds: mode === 'call' ? 2 : 3,
        effort: mode === 'call' ? 'low' : 'medium',
        events: {
          onToken: (text) => sse.send('token', { text }),
          onTool: (name, status, summary) => sse.send('tool', { name, status, summary }),
          onProductCard: (card) => sse.send('product_card', card),
          onGap: (question) => sse.send('gap', { question }),
          onCitations: (entries) => sse.send('citations', { entries }),
        },
      })
      sse.send('done', { ms: Date.now() - started })
    } catch (err) {
      sse.send('error', { message: String(err) })
    } finally {
      stopKeepalive()
      sse.close()
    }
  })()

  return sse.response
}

export const config: Config = { path: '/api/chat' }
