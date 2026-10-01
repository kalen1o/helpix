import { describe, expect, it } from 'vitest'
import type { ChatStreamEvent } from '../src/api-types'
import { chatEvents, chipsFor, toChatToolEvent } from '../src/chat'

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
