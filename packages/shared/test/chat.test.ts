import { describe, expect, it } from 'vitest'
import { toChatToolEvent } from '../src/chat'

const hit = (documentId: string, title: string, position: number) => ({ documentId, title, position, text: 't', score: 0.5 })

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
