// Pure TypeScript with no Node imports: the dashboard imports it through `@helpix/shared/chat`.
import type { ChatSource, ChatToolEvent, ToolActivity } from './api-types'

/** The longest message a customer or admin may send in one turn. */
export const CHAT_MESSAGE_MAX = 2000

/** A tool call as the stream's `tool` event: its status and the distinct documents it cited, in rank order. */
export function toChatToolEvent(activity: ToolActivity): ChatToolEvent {
  const sources = new Map<string, ChatSource>()
  for (const r of activity.results) {
    if (!sources.has(r.documentId)) sources.set(r.documentId, { documentId: r.documentId, title: r.title })
  }
  return { name: activity.name, status: activity.status, sources: [...sources.values()] }
}
