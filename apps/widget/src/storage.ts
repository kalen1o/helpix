import type { ChatToolEvent } from '@helpix/shared/api-types'

export interface StoredSession {
  conversationId: string
  sessionToken: string | null
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
  return { conversationId: v.conversationId, sessionToken: typeof v.sessionToken === 'string' ? v.sessionToken : null }
}

export function saveSession(widgetKey: string, s: StoredSession): void {
  write(local, keyFor(widgetKey), s)
}

export function clearSession(widgetKey: string): void {
  remove(local, keyFor(widgetKey))
  remove(session, keyFor(widgetKey))
}

export function loadHistory(widgetKey: string): StoredMessage[] {
  const v = read(session, keyFor(widgetKey))
  if (!Array.isArray(v)) return []
  return v.filter(
    (m): m is StoredMessage =>
      !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && Array.isArray(m.tools),
  )
}

export function saveHistory(widgetKey: string, messages: StoredMessage[]): void {
  write(session, keyFor(widgetKey), messages)
}
