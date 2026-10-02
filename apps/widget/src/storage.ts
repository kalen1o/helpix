import type { ChatToolEvent } from '@helpix/shared/api-types'

export interface StoredSession {
  conversationId: string
  sessionToken: string | null
  /** The shopper who owns the conversation; null for a guest. A conversation never changes owner. */
  customerId: string | null
}

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  tools: ChatToolEvent[]
}

const keyFor = (widgetKey: string) => `helpix:${widgetKey}`

// Storage can be missing or throw (blocked site data, private windows, sandboxed iframes): never let that break chat.
function read(store: () => Storage, key: string): unknown {
  try {
    const raw = store().getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function write(store: () => Storage, key: string, value: unknown): void {
  try {
    store().setItem(key, JSON.stringify(value))
  } catch {
    // Not persisted; the conversation still works for this page view.
  }
}

function remove(store: () => Storage, key: string): void {
  try {
    store().removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

export function loadSession(widgetKey: string): StoredSession | null {
  const v = read(local, keyFor(widgetKey)) as Partial<StoredSession> | null
  if (!v || typeof v.conversationId !== 'string') return null
  return {
    conversationId: v.conversationId,
    sessionToken: typeof v.sessionToken === 'string' ? v.sessionToken : null,
    // Sessions stored before shopper sign-in existed have no owner field: they belong to a guest.
    customerId: typeof v.customerId === 'string' ? v.customerId : null,
  }
}

export function saveSession(widgetKey: string, s: StoredSession): void {
  write(local, keyFor(widgetKey), s)
}

export function clearSession(widgetKey: string): void {
  remove(local, keyFor(widgetKey))
  remove(session, keyFor(widgetKey))
}

const isMessage = (m: unknown): m is StoredMessage => {
  const v = m as StoredMessage | null
  return !!v && (v.role === 'user' || v.role === 'assistant') && typeof v.content === 'string' && Array.isArray(v.tools)
}

function historyOwner(v: unknown): string | null {
  if (Array.isArray(v)) return null
  const owner = (v as { customerId?: unknown } | null)?.customerId
  return typeof owner === 'string' ? owner : null
}

/**
 * This tab's finished messages, only if they belong to `customerId` (null for a guest); otherwise empty. Nothing is
 * removed: a transcript stays in storage for its owner, and is never shown to anyone else. A bare array, written
 * before shopper sign-in existed, belongs to a guest.
 */
export function loadHistory(widgetKey: string, customerId: string | null): StoredMessage[] {
  const v = read(session, keyFor(widgetKey))
  const list = Array.isArray(v) ? v : (v as { messages?: unknown } | null)?.messages
  if (!Array.isArray(list) || historyOwner(v) !== customerId) return []
  return list.filter(isMessage)
}

/** Removes the stored session and this tab's transcript, but only those that belong to `customerId`. */
export function clearOwnedBy(widgetKey: string, customerId: string | null): void {
  if (loadSession(widgetKey)?.customerId === customerId) remove(local, keyFor(widgetKey))
  const v = read(session, keyFor(widgetKey))
  if (v !== null && historyOwner(v) === customerId) remove(session, keyFor(widgetKey))
}

export function saveHistory(widgetKey: string, history: { customerId: string | null; messages: StoredMessage[] }): void {
  write(session, keyFor(widgetKey), history)
}
