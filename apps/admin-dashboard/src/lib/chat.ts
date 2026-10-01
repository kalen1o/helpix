import type { ChatStreamEvent, ChatToolEvent, ConversationSummary } from '@helpix/shared/api-types'
import { readSseEvents } from '@helpix/shared/sse'

export { CHAT_MESSAGE_MAX, toChatToolEvent } from '@helpix/shared/chat'

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

export function customerLabel(c: Pick<ConversationSummary, 'isPlayground' | 'customerId'>): string {
  if (c.isPlayground) return c.customerId ? `Test as ${c.customerId}` : 'Admin test'
  return c.customerId ?? 'Anonymous visitor'
}

export interface Chip {
  key: string
  label: string
  tone: 'source' | 'empty' | 'error'
}

/** The chips under a reply: each cited document once, or why there are none. */
export function chipsFor(tools: ChatToolEvent[]): Chip[] {
  const chips: Chip[] = []
  const seen = new Set<string>()
  const add = (chip: Chip) => {
    if (seen.has(chip.key)) return
    seen.add(chip.key)
    chips.push(chip)
  }
  for (const t of tools) {
    const what = t.name === 'search_kb' ? 'the knowledge base' : t.name
    if (t.status === 'error') add({ key: `error:${t.name}`, label: `Couldn't check ${what}`, tone: 'error' })
    else if (t.sources.length === 0) add({ key: `empty:${t.name}`, label: 'No matching documents', tone: 'empty' })
    else for (const s of t.sources) add({ key: `source:${s.documentId}`, label: s.title, tone: 'source' })
  }
  return chips
}
