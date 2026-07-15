import type { Config } from '@netlify/functions'
import { runAgent } from './lib/anthropic'
import { identityLayer, groundingLayer, modeLayer } from './lib/prompts/system'

/**
 * The bridge: an OpenAI-compatible /chat/completions endpoint that exposes THE
 * BRAIN (our grounded, self-learning agent) to ElevenLabs Conversational AI.
 *
 * ElevenLabs owns the voice — speech-to-text, turn-taking, text-to-speech,
 * WebRTC playback and noise cancellation. For every answer it calls THIS
 * endpoint as its "custom LLM": we run our real agent (hybrid retrieval over
 * the knowledge base + products, Claude, guardrails, citations, learning) and
 * stream the reply back as OpenAI chat-completion chunks, which ElevenLabs
 * reads aloud in the chosen voice.
 *
 * Net effect: ElevenLabs' fast, natural voice on the front; our accurate,
 * grounded Brain doing the thinking. Configure ElevenLabs' custom-LLM base URL
 * to `<site>/api/agent` (it appends `/chat/completions`).
 */

type OAIMessage = { role: string; content: string | { text?: string }[] | null }

function textOf(content: OAIMessage['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : (c?.text ?? ''))).join(' ')
  return ''
}

/** ElevenLabs speaks whatever text we stream — never let a tag or id reach the voice. */
function makeSpeechFilter() {
  let raw = ''
  let sent = 0
  // strip tags AND any bare uuid/id that slips through — ElevenLabs must never
  // read a card id out loud (e.g. "...Nm160. 70e66d68-edac-...")
  const clean = (s: string) =>
    s
      .replace(/<cited>[\s\S]*?<\/cited>/g, '')
      .replace(/<draft>[\s\S]*?<\/draft>/g, '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
      .replace(/\s+([.,!?])/g, '$1')
  return {
    /** feed a token, get back only the newly-safe text to emit */
    push(token: string): string {
      raw += token
      let text = clean(raw)
      // withhold from a dangling '<' — it might be the start of a tag still arriving
      const lt = text.lastIndexOf('<')
      if (lt !== -1 && text.indexOf('>', lt) === -1) text = text.slice(0, lt)
      // withhold a trailing in-progress id (a run of hex/dashes not yet closed) so a
      // partial uuid is never spoken before clean() can drop the whole thing
      const idTail = /[0-9a-f]{8}[0-9a-f-]*$/i.exec(text)
      if (idTail) text = text.slice(0, idTail.index)
      if (text.length <= sent) return ''
      const delta = text.slice(sent)
      sent = text.length
      return delta
    },
    /** flush everything remaining once the answer is complete */
    finish(): string {
      const text = clean(raw)
      const delta = text.length > sent ? text.slice(sent) : ''
      sent = text.length
      return delta
    },
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })

  // shared-secret gate: ElevenLabs sends this on every call (set it as the
  // custom-LLM API key). If unset we allow (local dev), but warn.
  const secret = process.env.ELEVENLABS_LLM_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 })
  }

  let body: { messages?: OAIMessage[]; stream?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return new Response('invalid JSON', { status: 400 })
  }

  // Keep only the real back-and-forth; ElevenLabs' own system prompt is ignored
  // in favour of OUR grounding/identity (accuracy is non-negotiable).
  const turns = (body.messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: textOf(m.content).trim() }))
    .filter((m) => m.content)
    .slice(-10)
  if (!turns.length) return new Response('no user message', { status: 400 })

  const system = [identityLayer(), groundingLayer({ spoken: true }), modeLayer('voice')].join('\n\n')

  const runOpts = {
    system,
    messages: turns,
    tier: 'fast' as const, // speed: the voice loop needs snappy first tokens
    effort: 'low' as const,
    forceToolFirstRound: true, // accuracy: never answer a real question without searching first
    maxToolRounds: 2,
  }

  const id = `chatcmpl-${crypto.randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const model = 'the-brain'

  // Non-streaming fallback (some callers probe with stream:false)
  if (body.stream === false) {
    let text = ''
    await runAgent({ ...runOpts, events: { onToken: (t) => (text += t), onTool: noop, onProductCard: noop, onGap: noop, onCitations: noop } })
    const spoken = text
      .replace(/<cited>[\s\S]*?<\/cited>/g, '')
      .replace(/<draft>[\s\S]*?<\/draft>/g, '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
      .trim()
    return Response.json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: spoken }, finish_reason: 'stop' }],
    })
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (delta: Record<string, unknown>, finish: string | null = null) =>
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
          ),
        )
      const filter = makeSpeechFilter()
      try {
        send({ role: 'assistant' }) // opening chunk
        await runAgent({
          ...runOpts,
          events: {
            onToken: (t) => {
              const safe = filter.push(t)
              if (safe) send({ content: safe })
            },
            onTool: noop,
            onProductCard: noop,
            onGap: noop,
            onCitations: noop,
          },
        })
        const tail = filter.finish()
        if (tail) send({ content: tail })
        send({}, 'stop')
        controller.enqueue(enc.encode('data: [DONE]\n\n'))
      } catch (err) {
        // surface something speakable rather than a dead stream
        send({ content: ' Sorry, the brain dropped out — say that again?' })
        send({}, 'stop')
        controller.enqueue(enc.encode('data: [DONE]\n\n'))
        console.error('agent-llm stream error:', err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' },
  })
}

function noop() {
  /* events we don't forward to the voice stream */
}

export const config: Config = { path: '/api/agent/chat/completions' }
