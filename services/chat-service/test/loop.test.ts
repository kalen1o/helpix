import { ChatError, createScriptedChat, type ChatEvent, type ChatMessage } from '@helpix/llm'
import type { ToolActivity } from '@helpix/shared/api-types'
import { describe, expect, it } from 'vitest'
import { EMPTY_REPLY, runAgent } from '../src/agent/loop'
import type { AgentTool } from '../src/agent/searchKb'

const text = (t: string): ChatEvent => ({ type: 'text', text: t })
const call = (id: string, name = 'search_kb', args = '{"query":"q"}'): ChatEvent => ({ type: 'tool_call', call: { id, name, arguments: args } })
const done = (reason = 'stop'): ChatEvent => ({ type: 'done', finishReason: reason })
const MESSAGES: ChatMessage[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'Refunds?' }]

function echoTool(): AgentTool & { args: string[] } {
  const args: string[] = []
  return {
    args,
    definition: { name: 'search_kb', description: 'Search', parameters: {} },
    async run(raw) {
      args.push(raw)
      const activity: ToolActivity = { name: 'search_kb', arguments: JSON.parse(raw), status: 'ok', results: [], error: null }
      return { content: `result for ${raw}`, activity }
    },
  }
}

function run(chat: ReturnType<typeof createScriptedChat>, tools: AgentTool[] = [echoTool()], maxToolRounds = 3) {
  const deltas: string[] = []
  const toolEvents: ToolActivity[] = []
  const result = runAgent({
    chat,
    model: 'm',
    messages: MESSAGES,
    tools,
    maxToolRounds,
    signal: new AbortController().signal,
    onText: (t) => deltas.push(t),
    onTool: (a) => toolEvents.push(a),
  })
  return { result, deltas, toolEvents }
}

describe('runAgent', () => {
  it('streams a plain answer without a leading newline, offering the tools', async () => {
    const chat = createScriptedChat([[text('\n'), text('\nHello'), text(' there'), done()]])
    const { result, deltas } = run(chat)
    expect(await result).toEqual({ text: 'Hello there', tools: [] })
    expect(deltas).toEqual(['Hello', ' there'])
    expect(chat.requests[0]!.model).toBe('m')
    expect(chat.requests[0]!.tools?.map((t) => t.name)).toEqual(['search_kb'])
  })

  it('runs a tool call and sends its result back to the model', async () => {
    const chat = createScriptedChat([[call('c1'), done('tool_calls')], [text('Within 30 days.'), done()]])
    const tool = echoTool()
    const { result, toolEvents } = run(chat, [tool])
    const out = await result
    expect(out.text).toBe('Within 30 days.')
    expect(tool.args).toEqual(['{"query":"q"}'])
    expect(toolEvents).toHaveLength(1)
    expect(out.tools).toEqual(toolEvents)
    expect(chat.requests[1]!.messages.slice(2)).toEqual([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_kb', arguments: '{"query":"q"}' }] },
      { role: 'tool', toolCallId: 'c1', content: 'result for {"query":"q"}' },
    ])
  })

  it('separates preamble text from the answer that follows a tool round', async () => {
    const chat = createScriptedChat([[text("\nI'll check."), call('c1'), done('tool_calls')], [text('\nRefunds within 30 days.'), done()]])
    const { result, deltas } = run(chat)
    expect((await result).text).toBe("I'll check.\n\nRefunds within 30 days.")
    expect(deltas).toEqual(["I'll check.", '\n\nRefunds within 30 days.'])
  })

  it('answers an unknown tool with an error result and carries on', async () => {
    const chat = createScriptedChat([[call('c1', 'delete_everything', '{}'), done('tool_calls')], [text('Sorry.'), done()]])
    const { result, toolEvents } = run(chat)
    expect((await result).text).toBe('Sorry.')
    expect(toolEvents[0]).toMatchObject({ name: 'delete_everything', status: 'error', error: 'unknown_tool' })
    expect(chat.requests[1]!.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'c1', content: expect.stringContaining('Unknown tool') })
  })

  it('stops offering tools after the round cap and ignores further tool calls', async () => {
    const chat = createScriptedChat((_req, n) => (n < 2 ? [call(`c${n}`), done('tool_calls')] : [text('Final.'), call('late'), done()]))
    const { result, toolEvents } = run(chat, [echoTool()], 2)
    expect((await result).text).toBe('Final.')
    expect(toolEvents).toHaveLength(2)
    expect(chat.requests).toHaveLength(3)
    expect(chat.requests[2]!.tools).toBeUndefined()
  })

  it('sends a fallback when the model says nothing', async () => {
    const chat = createScriptedChat([[text('  \n'), done()]])
    const { result, deltas } = run(chat)
    expect((await result).text).toBe(EMPTY_REPLY)
    expect(deltas).toEqual([EMPTY_REPLY])
  })

  it('passes a model failure through after the text already streamed', async () => {
    const chat = createScriptedChat([[text('Partial'), new ChatError('down', true)]])
    const { result, deltas } = run(chat)
    await expect(result).rejects.toBeInstanceOf(ChatError)
    expect(deltas).toEqual(['Partial'])
  })
})
