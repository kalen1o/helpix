import type { FastifyReply, FastifyRequest } from 'fastify'
import { formatSseEvent, HEADERS } from '@helpix/shared'
import type { ChatStreamEvent } from '@helpix/shared/api-types'

export interface EventStream {
  send(e: ChatStreamEvent): void
  end(): void
  /** Aborted when the client disconnects before end(). */
  readonly signal: AbortSignal
}

/**
 * Takes over the reply as a text/event-stream (spec §3.1). Fastify's error handler no longer applies after this,
 * so failures must be sent as an `error` event.
 */
export function openEventStream(req: FastifyRequest, reply: FastifyReply): EventStream {
  const controller = new AbortController()
  reply.hijack()
  const raw = reply.raw
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
    [HEADERS.requestId]: req.id,
  })
  raw.on('close', () => {
    if (!raw.writableEnded) controller.abort(new Error('client disconnected'))
  })
  // The client may have gone while the caller was still awaiting; 'close' has then already fired.
  if (raw.destroyed) controller.abort(new Error('client disconnected'))
  return {
    signal: controller.signal,
    send(e) {
      if (!raw.writableEnded && !raw.destroyed) raw.write(formatSseEvent(e.event, e.data))
    },
    end() {
      if (!raw.writableEnded) raw.end()
    },
  }
}
