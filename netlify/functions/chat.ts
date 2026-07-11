import type { Config } from '@netlify/functions'
import { createSSE, jsonResponse, startKeepalive } from './lib/sse'
import { runAgent, type Citation } from './lib/anthropic'
import { authenticate, serviceClient, MOCK_USER } from './lib/auth'
import { isSupabaseConfigured } from './lib/env'
import { identityLayer, groundingLayer, modeLayer } from './lib/prompts/system'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' })
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure
  const user = auth.user

  let body: {
    conversationId?: string | null
    message?: string
    mode?: 'chat' | 'call' | 'voice'
    history?: { role: 'user' | 'assistant'; content: string }[]
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' })
  }
  const message = (body.message ?? '').trim()
  if (!message) return jsonResponse(400, { error: 'message required' })
  const mode = body.mode === 'call' || body.mode === 'voice' ? body.mode : 'chat'
  // client sends recent turns so memory doesn't depend on a DB write finishing
  // inside the 10s streaming cap; trimmed + capped server-side
  const clientHistory = (body.history ?? [])
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .slice(-8)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }))

  const sse = createSSE()
  const isNewConversation = !body.conversationId
  const conversationId = body.conversationId ?? crypto.randomUUID()
  const messageId = crypto.randomUUID()

  // run the agent without blocking the response
  void (async () => {
    sse.send('meta', { conversationId, messageId })
    const stopKeepalive = startKeepalive(sse)
    const started = Date.now()
    const citations: Citation[] = []
    const productIds: string[] = []
    try {
      const { text } = await runAgent({
        system: [identityLayer(), groundingLayer(), modeLayer(mode)].join('\n\n'),
        messages: [...clientHistory, { role: 'user', content: message }],
        maxToolRounds: mode === 'chat' ? 3 : 2,
        effort: mode === 'chat' ? 'medium' : 'low',
        // every conversational surface runs the fast tier — TTFT is the product
        // (CLAUDE.md #5); the deep model stays on Draft where prose quality pays
        tier: 'fast',
        // teaching from the call goes to the approval queue — admins only
        captureAsUser: mode === 'voice' && user.role === 'admin' && user.id !== MOCK_USER.id ? user.id : undefined,
        events: {
          onToken: (t) => sse.send('token', { text: t }),
          onTool: (name, status, summary) => sse.send('tool', { name, status, summary }),
          onProductCard: (card) => {
            productIds.push(card.id)
            sse.send('product_card', card)
          },
          onGap: (question) => sse.send('gap', { question }),
          onCitations: (entries) => {
            citations.push(...entries)
            sse.send('citations', { entries })
          },
        },
      })
      sse.send('done', { ms: Date.now() - started })
      // record for thumbs/usage — best effort, after 'done' so it never delays the answer
      await persistTurn({ conversationId, isNewConversation, messageId, userId: user.id, question: message, answer: text, citations, productIds })
    } catch (err) {
      sse.send('error', { message: String(err) })
    } finally {
      stopKeepalive()
      sse.close()
    }
  })()

  return sse.response
}

/**
 * S4-lite persistence: save the turn so feedback (thumbs) has something to
 * attach to. Best-effort — a storage hiccup must never kill the answer.
 */
async function persistTurn(args: {
  conversationId: string
  isNewConversation: boolean
  messageId: string
  userId: string
  question: string
  answer: string
  citations: Citation[]
  productIds: string[]
}): Promise<void> {
  if (!isSupabaseConfigured || args.userId === MOCK_USER.id) return
  try {
    const db = serviceClient()
    if (args.isNewConversation) {
      await db
        .from('conversations')
        .upsert(
          { id: args.conversationId, user_id: args.userId, mode: 'chat', title: args.question.slice(0, 80) },
          { onConflict: 'id', ignoreDuplicates: true },
        )
    }
    const cleanAnswer = args.answer.replace(/<cited>[\s\S]*?(<\/cited>|$)/g, '').trimEnd()
    // valid uuids only — mock corpus ids like "k-shade-sails" would fail the uuid[] columns
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    // BOTH rows need an explicit id: PostgREST array-insert unions keys, so a row
    // missing `id` gets null (not the column default) and fails not-null.
    await db.from('messages').insert([
      { id: crypto.randomUUID(), conversation_id: args.conversationId, role: 'user', content: args.question },
      {
        id: args.messageId,
        conversation_id: args.conversationId,
        role: 'assistant',
        content: cleanAnswer,
        cited_entry_ids: args.citations.map((c) => c.id).filter((id) => uuidRe.test(id)),
        cited_product_ids: args.productIds.filter((id) => uuidRe.test(id)),
      },
    ])
  } catch (err) {
    console.error('persistTurn failed (answer already delivered):', err)
  }
}

export const config: Config = { path: '/api/chat' }
