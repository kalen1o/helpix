import type { ChatMessage, ChatProvider, ToolCall } from '@helpix/llm'
import type { ToolActivity } from '@helpix/shared/api-types'
import type { AgentTool, ToolOutcome } from './searchKb'

export const EMPTY_REPLY = "Sorry, I couldn't come up with an answer. Please try again."

export interface AgentRunInput {
  chat: ChatProvider
  model: string
  messages: ChatMessage[]
  tools: AgentTool[]
  /** Rounds that may call tools; one more round without tools follows if the model is still calling them. */
  maxToolRounds: number
  signal: AbortSignal
  onText(text: string): void
  onTool(activity: ToolActivity): void
}

function unknownTool(call: ToolCall): ToolOutcome {
  return {
    content: JSON.stringify({ error: `Unknown tool "${call.name}".` }),
    activity: { name: call.name, arguments: null, status: 'error', results: [], error: 'unknown_tool' },
  }
}

/**
 * The agent loop (spec §3.4): stream a round; if it ends in tool calls, run them, append the results and go again.
 * Text is passed to `onText` as it arrives, without the blank lines GLM tends to lead with, and with a paragraph
 * break between rounds so preamble text ("Let me check.") does not run into the answer.
 */
export async function runAgent(input: AgentRunInput): Promise<{ text: string; tools: ToolActivity[] }> {
  const messages = [...input.messages]
  const activities: ToolActivity[] = []
  const tools = new Map(input.tools.map((t) => [t.definition.name, t]))
  let text = ''
  let pendingBreak = false

  const emit = (piece: string) => {
    let out = text && !pendingBreak ? piece : piece.trimStart()
    if (!out) return
    if (pendingBreak) {
      out = `\n\n${out}`
      pendingBreak = false
    }
    text += out
    input.onText(out)
  }

  for (let round = 0; round <= input.maxToolRounds; round++) {
    const offerTools = round < input.maxToolRounds && input.tools.length > 0
    let roundText = ''
    const calls: ToolCall[] = []
    for await (const event of input.chat.chat({
      model: input.model,
      messages,
      tools: offerTools ? input.tools.map((t) => t.definition) : undefined,
      signal: input.signal,
    })) {
      if (event.type === 'text') {
        roundText += event.text
        emit(event.text)
      } else if (event.type === 'tool_call' && offerTools) {
        calls.push(event.call)
      }
    }
    if (calls.length === 0) break

    messages.push({ role: 'assistant', content: roundText, toolCalls: calls })
    for (const call of calls) {
      const outcome = await (tools.get(call.name)?.run(call.arguments) ?? Promise.resolve(unknownTool(call)))
      messages.push({ role: 'tool', toolCallId: call.id, content: outcome.content })
      activities.push(outcome.activity)
      input.onTool(outcome.activity)
    }
    if (text) pendingBreak = true
  }

  if (!text) emit(EMPTY_REPLY)
  return { text: text.trimEnd(), tools: activities }
}
