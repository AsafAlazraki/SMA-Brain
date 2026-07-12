import type { Config } from '@netlify/functions'
import { createSSE, jsonResponse, startKeepalive } from './lib/sse'
import { runAgent, type Citation } from './lib/anthropic'
import { authenticate, serviceClient, MOCK_USER } from './lib/auth'
import { isSupabaseConfigured, isVoiceConfigured } from './lib/env'
import { identityLayer, groundingLayer, modeLayer } from './lib/prompts/system'
import { synthesize } from './lib/voice/elevenlabs'

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

  // Voice mode: synthesize her voice server-side, sentence by sentence, and
  // push it down the SAME stream as base64 'audio' events. Kills a browser↔
  // function round-trip per sentence and overlaps synthesis with generation —
  // the function sits ~100ms from ElevenLabs; the browser sits ~300ms from us.
  const serverAudio = mode === 'voice' && isVoiceConfigured

  // Anything that isn't pure chit-chat must hit a tool before answering —
  // the fast model otherwise skips retrieval on questions that "feel"
  // unanswerable and claims ignorance about things Tony taught it yesterday.
  const CHITCHAT =
    /^(g'?day|hi+|hey+|hello+|yo|howdy|thanks?( heaps| mate)?|thank you|cheers( mate)?|ta|no worries|all good|too easy|bye+|see ya|catch ya|later|that's (all|everything)|ok(ay)?|yep|yeah|nah|yes|no)[\s!.,?]*$/i
  const forceTool = mode === 'voice' && !(message.length < 40 && CHITCHAT.test(message))

  // run the agent without blocking the response
  void (async () => {
    sse.send('meta', { conversationId, messageId, serverAudio })
    const stopKeepalive = startKeepalive(sse)
    const started = Date.now()
    const citations: Citation[] = []
    const productIds: string[] = []
    const speech = serverAudio ? createSpeechPipeline(sse, started) : null
    try {
      const { text } = await runAgent({
        system: [identityLayer(), groundingLayer(), modeLayer(mode)].join('\n\n'),
        messages: [...clientHistory, { role: 'user', content: message }],
        maxToolRounds: mode === 'chat' ? 3 : 2,
        effort: mode === 'chat' ? 'medium' : 'low',
        // every conversational surface runs the fast tier — TTFT is the product
        // (CLAUDE.md #5); the deep model stays on Draft where prose quality pays
        tier: 'fast',
        forceToolFirstRound: forceTool,
        // teaching from the call goes to the approval queue — admins only
        captureAsUser: mode === 'voice' && user.role === 'admin' && user.id !== MOCK_USER.id ? user.id : undefined,
        callerToken: user.role === 'admin' ? (/^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? null) : null,
        events: {
          onToken: (t) => {
            sse.send('token', { text: t })
            speech?.addText(t)
          },
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
      if (speech) await speech.finish()
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

/** <cited>/<draft> blocks and markdown never reach her voice. */
function stripSpeakable(s: string): string {
  return s
    .replace(/<cited>[\s\S]*?(<\/cited>|$)/g, '')
    .replace(/<draft>[\s\S]*?(<\/draft>|$)/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}

/**
 * Streaming text → ordered base64 mp3 'audio' SSE events. Sentences are
 * synthesized as they complete (max 2 in flight — ElevenLabs free concurrency)
 * with previous_text prosody continuity; sends stay in sentence order.
 * The 10s streaming cap is guarded: past 8s no new synthesis starts and the
 * unspoken tail is handed to the client via 'audio_done'.
 */
function createSpeechPipeline(sse: ReturnType<typeof createSSE>, started: number) {
  const SENTENCE_END = /[.!?…]+["')\]]?\s/
  let raw = ''
  let consumed = 0
  let prevSentence = ''
  let count = 0
  let active = 0
  const backlog: { i: number; text: string; prev: string }[] = []
  let sendChain = Promise.resolve()

  const overBudget = () => Date.now() - started > 8000

  const pump = () => {
    while (active < 2 && backlog.length > 0) {
      const job = backlog.shift()!
      active++
      const audio = synthesize(stripSpeakable(job.text), job.prev || undefined)
        .then((buf) => Buffer.from(buf).toString('base64'))
        .catch(() => null)
      void audio.finally(() => {
        active--
        pump()
      })
      sendChain = sendChain.then(async () => {
        const b64 = await audio
        if (b64) sse.send('audio', { i: job.i, b64 })
      })
    }
  }

  const schedule = (sentence: string) => {
    const clean = sentence.trim()
    if (clean.length < 2) return
    backlog.push({ i: count++, text: clean, prev: prevSentence })
    prevSentence = clean
    pump()
  }

  const speakableSoFar = () => {
    let s = stripSpeakable(raw)
    // a partially-streamed tag ("<dra…") isn't speakable yet — hold it back
    const tagStart = s.lastIndexOf('<')
    if (tagStart > -1 && !s.includes('>', tagStart)) s = s.slice(0, tagStart)
    return s
  }

  return {
    addText(delta: string) {
      raw += delta
      if (overBudget()) return
      const s = speakableSoFar()
      for (;;) {
        const rest = s.slice(consumed)
        const m = SENTENCE_END.exec(rest)
        if (!m) break
        const end = m.index + m[0].length
        const candidate = rest.slice(0, end)
        if (candidate.trim().length < 24 && rest.length < 160) break
        schedule(candidate)
        consumed += end
      }
    },
    async finish() {
      const tail = speakableSoFar().slice(consumed).trim()
      const spokeTail = Boolean(tail) && !overBudget()
      if (spokeTail) schedule(tail)
      await sendChain
      sse.send('audio_done', { count, tail: spokeTail ? '' : tail })
    },
  }
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
