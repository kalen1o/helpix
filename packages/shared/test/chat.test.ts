import { describe, expect, it } from 'vitest'
import type { ChatStreamEvent, ChatToolEvent } from '../src/api-types'
import { chatEvents, chipsFor, orderToolStatus, toChatToolEvent } from '../src/chat'
import { HEADERS, IDENTITY_HEADERS } from '../src/headers'

const hit = (documentId: string, title: string, position: number) => ({ documentId, title, position, text: 't', score: 0.5 })

async function collect(res: Response): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const e of chatEvents(res)) out.push(e)
  return out
}

describe('toChatToolEvent', () => {
  it('lists each cited document once, in rank order', () => {
    const event = toChatToolEvent({
      name: 'search_kb',
      arguments: { query: 'returns' },
      status: 'ok',
      results: [hit('d2', 'Shipping', 0), hit('d1', 'Returns', 0), hit('d2', 'Shipping', 1)],
      error: null,
    })
    expect(event).toEqual({
      name: 'search_kb',
      status: 'ok',
      sources: [
        { documentId: 'd2', title: 'Shipping' },
        { documentId: 'd1', title: 'Returns' },
      ],
    })
  })
})

describe('chatEvents', () => {
  it('yields typed events and skips unknown names and unreadable data', async () => {
    const body = [
      'event: meta\ndata: {"conversationId":"c1"}\n\n',
      'event: ping\ndata: {}\n\n',
      'event: delta\ndata: not-json\n\n',
      'event: delta\ndata: {"text":"Hi"}\n\n',
      'event: done\ndata: {"messageId":"m1"}\n\n',
    ].join('')
    expect(await collect(new Response(body))).toEqual([
      { event: 'meta', data: { conversationId: 'c1' } },
      { event: 'delta', data: { text: 'Hi' } },
      { event: 'done', data: { messageId: 'm1' } },
    ])
  })
})

describe('chipsFor', () => {
  it('lists each source once across tool calls, and says why when there are none', () => {
    const chips = chipsFor([
      { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Returns' }, { documentId: 'd2', title: 'Shipping' }] },
      { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Returns' }] },
      { name: 'search_kb', status: 'empty', sources: [] },
      { name: 'search_kb', status: 'error', sources: [] },
      { name: 'search_kb', status: 'error', sources: [] },
    ])
    expect(chips.map((c) => [c.tone, c.label])).toEqual([
      ['source', 'Returns'],
      ['source', 'Shipping'],
      ['empty', 'No matching documents'],
      ['error', "Couldn't check the knowledge base"],
    ])
  })
})

const ORDER = {
  orderId: '1047',
  status: 'processing' as const,
  placedAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  items: [{ name: 'iPhone 15', quantity: 1 }],
}

describe('toChatToolEvent for lookup_order', () => {
  it('copies only the order id and status of each order', () => {
    const event = toChatToolEvent({
      name: 'lookup_order',
      arguments: { orderId: '1047' },
      status: 'ok',
      results: [],
      error: null,
      orders: [{ ...ORDER, note: 'secret-ish detail' }],
    })
    expect(event).toEqual({ name: 'lookup_order', status: 'ok', sources: [], orders: [{ orderId: '1047', status: 'processing' }] })
  })

  it('leaves orders out when the activity has none', () => {
    const event = toChatToolEvent({ name: 'lookup_order', arguments: {}, status: 'error', results: [], error: 'unavailable' })
    expect('orders' in event).toBe(false)
  })
})

describe('chipsFor lookup_order', () => {
  it('shows one order chip per order, once', () => {
    const chips = chipsFor([
      { name: 'lookup_order', status: 'ok', sources: [], orders: [{ orderId: '1047', status: 'processing' }, { orderId: '1003', status: 'shipped' }] },
      { name: 'lookup_order', status: 'ok', sources: [], orders: [{ orderId: '1047', status: 'processing' }] },
    ])
    expect(chips).toEqual([
      { key: 'order:1047', label: 'Order #1047 · processing', tone: 'order' },
      { key: 'order:1003', label: 'Order #1003 · shipped', tone: 'order' },
    ])
  })

  it('says when the order was not found or could not be checked', () => {
    expect(chipsFor([{ name: 'lookup_order', status: 'empty', sources: [] }])).toEqual([
      { key: 'empty:lookup_order', label: 'Order not found', tone: 'empty' },
    ])
    expect(chipsFor([{ name: 'lookup_order', status: 'error', sources: [] }])).toEqual([
      { key: 'error:lookup_order', label: "Couldn't check your order", tone: 'error' },
    ])
  })

  it('says when the customer has no orders yet', () => {
    const tools: ChatToolEvent[] = [
      { name: 'lookup_order', status: 'ok', sources: [], orders: [] },
      { name: 'lookup_order', status: 'ok', sources: [] },
    ]
    for (const tool of tools) {
      expect(chipsFor([tool])).toEqual([{ key: 'none:lookup_order', label: 'No orders yet', tone: 'empty' }])
    }
  })

  it('keeps knowledge-base chips next to order chips', () => {
    const chips = chipsFor([
      { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Returns' }] },
      { name: 'lookup_order', status: 'ok', sources: [], orders: [{ orderId: '1047', status: 'processing' }] },
    ])
    expect(chips.map((c) => c.tone)).toEqual(['source', 'order'])
  })
})

describe('orderToolStatus', () => {
  it('maps lookup results to tool statuses', () => {
    expect(orderToolStatus('ok')).toBe('ok')
    expect(orderToolStatus('not_found')).toBe('empty')
    for (const s of ['unavailable', 'misconfigured', 'not_configured'] as const) expect(orderToolStatus(s)).toBe('error')
  })
})

describe('customer token header', () => {
  it('is a client credential, not a gateway identity header', () => {
    expect(HEADERS.customerToken).toBe('x-helpix-customer-token')
    expect(IDENTITY_HEADERS).not.toContain(HEADERS.customerToken)
    expect(IDENTITY_HEADERS).toContain(HEADERS.customerId)
  })
})
