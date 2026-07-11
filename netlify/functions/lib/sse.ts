/** Server-side SSE helpers for Netlify Functions v2 (web streams). */

export type SSEWriter = {
  send: (event: string, data: unknown) => void
  close: () => void
  readonly response: Response
}

/**
 * Emit an SSE comment every few seconds until the writer closes. Long silent
 * gaps (model thinking between tool rounds) get idle streams reaped by the
 * platform; a comment line is invisible to clients but keeps bytes flowing.
 */
export function startKeepalive(sse: SSEWriter, ms = 3000): () => void {
  const timer = setInterval(() => sse.send('ping', { t: 1 }), ms)
  return () => clearInterval(timer)
}

export function createSSE(): SSEWriter {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })

  return {
    response,
    send(event, data) {
      try {
        controller?.enqueue(encoder.encode(encodeSSE(event, data)))
      } catch {
        /* stream cancelled — client is gone, drop the event */
      }
    },
    close() {
      try {
        controller?.close()
      } catch {
        /* already closed */
      }
    },
  }
}

export function encodeSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
