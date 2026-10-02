import type { ConversationSummary } from '@helpix/shared/api-types'
import type { Order } from '@helpix/shared/orders'

export { CHAT_MESSAGE_MAX, chatEvents, chipsFor, toChatToolEvent, type Chip } from '@helpix/shared/chat'

export function customerLabel(c: Pick<ConversationSummary, 'isPlayground' | 'customerId'>): string {
  if (c.isPlayground) return c.customerId ? `Test as ${c.customerId}` : 'Admin test'
  return c.customerId ?? 'Anonymous visitor'
}

/** "#1047 · shipped · 1 × iPhone 15 (Blue, 128 GB), 2 × USB-C cable" */
export function orderSummary(o: Order): string {
  const items = o.items.map((i) => `${i.quantity} × ${i.name}${i.variant ? ` (${i.variant})` : ''}`).join(', ')
  return [`#${o.orderId}`, o.status, items].filter(Boolean).join(' · ')
}
