// Pure TypeScript with no Node imports: the dashboard imports it through `@helpix/shared/chat`.
import type { ChatSource, ChatStreamEvent, ChatToolEvent, ToolActivity, ToolStatus } from './api-types'
import type { OrderLookupStatus } from './orders'
import { readSseEvents } from './sse'

/** The longest message a customer or admin may send in one turn. */
export const CHAT_MESSAGE_MAX = 2000

/** A tool call as the stream's `tool` event: its status, the distinct documents it cited in rank order, and any orders (id and status only). */
export function toChatToolEvent(activity: ToolActivity): ChatToolEvent {
  const sources = new Map<string, ChatSource>()
  for (const r of activity.results) {
    if (!sources.has(r.documentId)) sources.set(r.documentId, { documentId: r.documentId, title: r.title })
  }
  const event: ChatToolEvent = { name: activity.name, status: activity.status, sources: [...sources.values()] }
  if (activity.orders) event.orders = activity.orders.map((o) => ({ orderId: o.orderId, status: o.status }))
  return event
}

/** How a lookup_order result is recorded as a tool status. */
export function orderToolStatus(status: OrderLookupStatus): ToolStatus {
  if (status === 'ok') return 'ok'
  if (status === 'not_found') return 'empty'
  return 'error'
}

const EVENTS = new Set<string>(['meta', 'delta', 'tool', 'done', 'error'])

/** Typed events from a chat SSE response. Unknown event names and unreadable data are skipped. */
export async function* chatEvents(res: Response): AsyncGenerator<ChatStreamEvent> {
  if (!res.body) return
  for await (const { event, data } of readSseEvents(res.body)) {
    if (!EVENTS.has(event)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      continue
    }
    yield { event, data: parsed } as ChatStreamEvent
  }
}

export interface Chip {
  key: string
  label: string
  tone: 'source' | 'empty' | 'error' | 'order'
}

/** The chips under a reply: each cited document or order once, or why there are none. */
export function chipsFor(tools: ChatToolEvent[]): Chip[] {
  const chips: Chip[] = []
  const seen = new Set<string>()
  const add = (chip: Chip) => {
    if (seen.has(chip.key)) return
    seen.add(chip.key)
    chips.push(chip)
  }
  for (const t of tools) {
    if (t.name === 'lookup_order') {
      if (t.status === 'error') add({ key: 'error:lookup_order', label: "Couldn't check your order", tone: 'error' })
      else if (t.status === 'empty') add({ key: 'empty:lookup_order', label: 'Order not found', tone: 'empty' })
      else if (!t.orders?.length) add({ key: 'none:lookup_order', label: 'No orders yet', tone: 'empty' })
      else for (const o of t.orders) add({ key: `order:${o.orderId}`, label: `Order #${o.orderId} · ${o.status}`, tone: 'order' })
      continue
    }
    const what = t.name === 'search_kb' ? 'the knowledge base' : t.name
    if (t.status === 'error') add({ key: `error:${t.name}`, label: `Couldn't check ${what}`, tone: 'error' })
    else if (t.sources.length === 0) add({ key: `empty:${t.name}`, label: 'No matching documents', tone: 'empty' })
    else for (const s of t.sources) add({ key: `source:${s.documentId}`, label: s.title, tone: 'source' })
  }
  return chips
}
