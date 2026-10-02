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

/**
 * A WidgetApi whose sendMessage answers from a queue and records every body,
 * plus the shopper token `getToken` returned for that send (null for a guest).
 */
export function fakeApi(
  replies: Array<Response | (() => Promise<Response>)>,
  config: WidgetConfig = WIDGET_CONFIG,
  getToken: () => string | null = () => null,
) {
  const bodies: SendBody[] = []
  const tokens: Array<string | null> = []
  const api: WidgetApi = {
    fetchConfig: async () => config,
    sendMessage: async (body) => {
      bodies.push(body)
      tokens.push(getToken())
      const next = replies.shift()
      if (!next) throw new Error('no scripted reply left')
      return typeof next === 'function' ? next() : next
    },
  }
  return { api, bodies, tokens }
}

function b64url(value: object): string {
  let bin = ''
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** An unsigned JWT-shaped string: the widget only reads `sub` and never verifies it. */
export function fakeJwt(payload: object): string {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`
}
