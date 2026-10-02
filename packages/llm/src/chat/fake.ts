import type { ChatEvent, ChatProvider, ChatRequest } from './types'

/**
 * A deterministic stand-in for a chat model, for keyless local development and the smoke test. Not for real answers.
 * When tools are offered and the last message is the user's, it calls the first tool with `{ query: <user text> }`.
 * When an order lookup tool is offered and the user mentions an order, it calls lookup_order with the order ID if present.
 * After a tool result shaped like chat-service's search_kb output (`{ results: [{ title, text }] }`) it quotes the top
 * result; after a lookup_order result it formats the order(s). Otherwise it says it doesn't know.
 */
export function createFakeChat(model = 'fake'): ChatProvider {
  return {
    defaultModel: model,
    async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
      const last = req.messages.at(-1)
      const userIndex = findLastIndex(req.messages, (m) => m.role === 'user')
      const user = userIndex === -1 ? undefined : req.messages[userIndex]
      const orderTool = req.tools?.find((t) => t.name === ORDER_TOOL)
      const lookedUp = req.messages
        .slice(userIndex + 1)
        .some((m) => m.role === 'assistant' && m.toolCalls?.some((c) => c.name === ORDER_TOOL))
      if (orderTool && user && /\border\b/i.test(user.content) && !lookedUp) {
        const orderId = /\d{3,}/.exec(user.content)?.[0]
        yield {
          type: 'tool_call',
          call: { id: `call_${req.messages.length}`, name: ORDER_TOOL, arguments: JSON.stringify(orderId ? { orderId } : {}) },
        }
        yield { type: 'done', finishReason: 'tool_calls' }
        return
      }
      if (last?.role === 'user' && req.tools?.length) {
        yield {
          type: 'tool_call',
          call: { id: `call_${req.messages.length}`, name: req.tools[0]!.name, arguments: JSON.stringify({ query: last.content }) },
        }
        yield { type: 'done', finishReason: 'tool_calls' }
        return
      }
      const answer =
        last?.role === 'tool'
          ? lookedUp && isOrderResult(req, last.toolCallId)
            ? answerFromOrders(last.content)
            : answerFrom(last.content)
          : "I don't know. Please contact the shop."
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

const ORDER_TOOL = 'lookup_order'

/** True when `toolCallId` belongs to a lookup_order call in this request. */
function isOrderResult(req: ChatRequest, toolCallId: string): boolean {
  return req.messages.some((m) => m.role === 'assistant' && m.toolCalls?.some((c) => c.id === toolCallId && c.name === ORDER_TOOL))
}

function answerFromOrders(toolContent: string): string {
  const line = (o: { orderId?: unknown; status?: unknown }) => `Order ${String(o.orderId)} is ${String(o.status)}.`
  try {
    const parsed = JSON.parse(toolContent) as { order?: { orderId?: unknown; status?: unknown }; orders?: { orderId?: unknown; status?: unknown }[] }
    if (parsed.order) return line(parsed.order)
    if (Array.isArray(parsed.orders)) return parsed.orders.length ? parsed.orders.map(line).join(' ') : 'You have no orders yet.'
  } catch {
    // The not-found and unavailable messages are plain sentences.
  }
  return "I couldn't check that order right now."
}

/** Find the last index in an array matching a predicate. Used because findLastIndex is ES2023 and this project targets ES2022. */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}
