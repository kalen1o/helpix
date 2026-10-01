import type { ChatEvent, ChatProvider, ChatRequest } from './types'

/**
 * A deterministic stand-in for a chat model, for keyless local development and the smoke test. Not for real answers.
 * When tools are offered and the last message is the user's, it calls the first tool with `{ query: <user text> }`.
 * After a tool result shaped like chat-service's search_kb output (`{ results: [{ title, text }] }`) it quotes the top
 * result; otherwise it says it doesn't know.
 */
export function createFakeChat(model = 'fake'): ChatProvider {
  return {
    defaultModel: model,
    async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
      const last = req.messages.at(-1)
      if (last?.role === 'user' && req.tools?.length) {
        yield {
          type: 'tool_call',
          call: { id: `call_${req.messages.length}`, name: req.tools[0]!.name, arguments: JSON.stringify({ query: last.content }) },
        }
        yield { type: 'done', finishReason: 'tool_calls' }
        return
      }
      const answer = last?.role === 'tool' ? answerFrom(last.content) : "I don't know. Please contact the shop."
      for (const word of answer.split(/(?<= )/)) yield { type: 'text', text: word }
      yield { type: 'done', finishReason: 'stop' }
    },
  }
}

function answerFrom(toolContent: string): string {
  try {
    const top = (JSON.parse(toolContent) as { results?: { title?: unknown; text?: unknown }[] }).results?.[0]
    if (typeof top?.title === 'string' && typeof top.text === 'string') return `From "${top.title}": ${top.text.slice(0, 200)}`
  } catch {
    // Not JSON: fall through.
  }
  return "I couldn't find that in the shop's documents. Please contact the shop directly."
}
