import { describe, expect, it } from 'vitest'
import { createFakeChat } from '../src/chat/fake'
import { createScriptedChat } from '../src/chat/scripted'
import { ChatError, type ChatEvent, type ChatRequest } from '../src/chat/types'

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of events) out.push(e)
  return out
}
const textOf = (events: ChatEvent[]) => events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')
const TOOL = { name: 'search_kb', description: 'Search', parameters: {} }

describe('createFakeChat', () => {
  it('calls the first offered tool with the user message', async () => {
    const events = await collect(createFakeChat().chat({ messages: [{ role: 'user', content: 'Refunds?' }], tools: [TOOL] }))
    expect(events).toEqual([
      { type: 'tool_call', call: { id: 'call_1', name: 'search_kb', arguments: '{"query":"Refunds?"}' } },
      { type: 'done', finishReason: 'tool_calls' },
    ])
  })

  it('answers from a search_kb result, word by word', async () => {
    const req: ChatRequest = {
      messages: [
        { role: 'user', content: 'Refunds?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'search_kb', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'c', content: JSON.stringify({ results: [{ title: 'Returns', text: 'Within 30 days.' }] }) },
      ],
      tools: [TOOL],
    }
    const events = await collect(createFakeChat().chat(req))
    expect(textOf(events)).toBe('From "Returns": Within 30 days.')
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(1)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
  })

  it("says it doesn't know without a usable result", async () => {
    const empty = await collect(
      createFakeChat().chat({ messages: [{ role: 'tool', toolCallId: 'c', content: '{"results":[]}' }] }),
    )
    expect(textOf(empty)).toBe("I couldn't find that in the shop's documents. Please contact the shop directly.")
    const noTools = await collect(createFakeChat('m').chat({ messages: [{ role: 'user', content: 'Hi' }] }))
    expect(textOf(noTools)).toBe("I don't know. Please contact the shop.")
  })

  const ORDER_TOOL = { name: 'lookup_order', description: 'Look up', parameters: {} }
  const prefetched = (user: string): ChatRequest['messages'] => [
    { role: 'user', content: user },
    { role: 'assistant', content: '', toolCalls: [{ id: 'p', name: 'search_kb', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'p', content: JSON.stringify({ results: [{ title: 'Shipping', text: 'Two days.' }] }) },
  ]

  it('calls lookup_order after the prefetched search when the customer asks about an order', async () => {
    const events = await collect(createFakeChat().chat({ messages: prefetched('Where is order #1047?'), tools: [TOOL, ORDER_TOOL] }))
    expect(events).toEqual([
      { type: 'tool_call', call: { id: 'call_3', name: 'lookup_order', arguments: '{"orderId":"1047"}' } },
      { type: 'done', finishReason: 'tool_calls' },
    ])
  })

  it('lists orders when no order number is given, and only calls lookup_order once per turn', async () => {
    const first = await collect(createFakeChat().chat({ messages: prefetched("Where's my ORDER?"), tools: [TOOL, ORDER_TOOL] }))
    expect(first[0]).toEqual({ type: 'tool_call', call: { id: 'call_3', name: 'lookup_order', arguments: '{}' } })

    const after: ChatRequest['messages'] = [
      ...prefetched("Where's my order?"),
      { role: 'assistant', content: '', toolCalls: [{ id: 'o', name: 'lookup_order', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'o', content: JSON.stringify({ orders: [{ orderId: '1008', status: 'processing' }, { orderId: '1001', status: 'delivered' }] }) },
    ]
    const answer = await collect(createFakeChat().chat({ messages: after, tools: [TOOL, ORDER_TOOL] }))
    expect(textOf(answer)).toBe('Order 1008 is processing. Order 1001 is delivered.')
  })

  it('answers a single order, an empty history and a failed lookup', async () => {
    const reply = async (content: string) =>
      textOf(
        await collect(
          createFakeChat().chat({
            messages: [
              { role: 'user', content: 'order 1047?' },
              { role: 'assistant', content: '', toolCalls: [{ id: 'o', name: 'lookup_order', arguments: '{}' }] },
              { role: 'tool', toolCallId: 'o', content },
            ],
            tools: [TOOL, ORDER_TOOL],
          }),
        ),
      )
    expect(await reply(JSON.stringify({ order: { orderId: '1047', status: 'shipped' } }))).toBe('Order 1047 is shipped.')
    expect(await reply(JSON.stringify({ orders: [], note: 'none' }))).toBe('You have no orders yet.')
    expect(await reply("No order with that number on this customer's account.")).toBe("I couldn't check that order right now.")
  })

  it('does not call lookup_order when it is not offered or the message is not about orders', async () => {
    const notOffered = await collect(createFakeChat().chat({ messages: prefetched('Where is order 1047?'), tools: [TOOL] }))
    expect(textOf(notOffered)).toBe('From "Shipping": Two days.')
    const notAboutOrders = await collect(createFakeChat().chat({ messages: prefetched('Shipping time?'), tools: [TOOL, ORDER_TOOL] }))
    expect(textOf(notAboutOrders)).toBe('From "Shipping": Two days.')
  })
})

describe('createScriptedChat', () => {
  it('replays rounds in order, records requests and throws Error items', async () => {
    const chat = createScriptedChat([[{ type: 'text', text: 'one' }], [new ChatError('down', true)]])
    expect(await collect(chat.chat({ messages: [{ role: 'user', content: 'a' }] }))).toEqual([{ type: 'text', text: 'one' }])
    await expect(collect(chat.chat({ messages: [] }))).rejects.toThrow('down')
    await expect(collect(chat.chat({ messages: [] }))).rejects.toThrow('no round scripted for call 2')
    expect(chat.requests.map((r) => r.messages.length)).toEqual([1, 0, 0])
  })
})
