// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ChatStreamEvent } from '@helpix/shared/api-types'
import { chatEvents, chipsFor, customerLabel } from '../src/lib/chat'

async function collect(res: Response): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const e of chatEvents(res)) out.push(e)
  return out
}

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

describe('customerLabel', () => {
  it.each([
    [{ isPlayground: false, customerId: 'cust_1001' }, 'cust_1001'],
    [{ isPlayground: false, customerId: null }, 'Anonymous visitor'],
    [{ isPlayground: true, customerId: 'cust_1001' }, 'Test as cust_1001'],
    [{ isPlayground: true, customerId: null }, 'Admin test'],
  ])('%j → %s', (c, label) => {
    expect(customerLabel(c)).toBe(label)
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
