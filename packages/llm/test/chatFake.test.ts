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
