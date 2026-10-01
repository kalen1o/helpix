import { formatSseEvent } from '@helpix/shared/sse'
import type { ChatStreamEvent, WidgetConfig } from '@helpix/shared/api-types'
import type { SendBody, WidgetApi } from '../src/api'

export const WIDGET_CONFIG: WidgetConfig = { shopName: 'Orchard Store', greeting: 'Hi from Orchard', accentColor: '#0C9A82', orderLookup: false }

export function sseResponse(events: ChatStreamEvent[]): Response {
  return new Response(events.map((e) => formatSseEvent(e.event, e.data)).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

export function errorResponse(status: number, code: string, message = 'nope'): Response {
  return new Response(JSON.stringify({ error: { code, message, requestId: 'r' } }), { status, headers: { 'content-type': 'application/json' } })
}

/** A WidgetApi whose sendMessage answers from a queue and records every body. */
export function fakeApi(replies: Array<Response | (() => Promise<Response>)>, config: WidgetConfig = WIDGET_CONFIG) {
  const bodies: SendBody[] = []
  const api: WidgetApi = {
    fetchConfig: async () => config,
    sendMessage: async (body) => {
      bodies.push(body)
      const next = replies.shift()
      if (!next) throw new Error('no scripted reply left')
      return typeof next === 'function' ? next() : next
    },
  }
  return { api, bodies }
}
