import type { ConversationSummary } from '@helpix/shared/api-types'

export { CHAT_MESSAGE_MAX, chatEvents, chipsFor, toChatToolEvent, type Chip } from '@helpix/shared/chat'

export function customerLabel(c: Pick<ConversationSummary, 'isPlayground' | 'customerId'>): string {
  if (c.isPlayground) return c.customerId ? `Test as ${c.customerId}` : 'Admin test'
  return c.customerId ?? 'Anonymous visitor'
}
