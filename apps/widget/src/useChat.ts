import { ref, watch, type Ref } from 'vue'
import type { ChatToolEvent } from '@helpix/shared/api-types'
import { CHAT_MESSAGE_MAX, chatEvents } from '@helpix/shared/chat'
import { readApiError, type SendBody, type WidgetApi } from './api'
import type { Identity } from './identity'
import { clearOwnedBy, clearSession, loadHistory, loadSession, saveHistory, saveSession } from './storage'

export interface WidgetMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tools: ChatToolEvent[]
  status: 'done' | 'streaming' | 'error'
  error?: string
}

const NETWORK_ERROR = "Couldn't reach the shop's assistant. Check your connection and try again."
const CUT_OFF = 'The reply was cut off. Try again.'
const TOKEN_REJECTED = "[helpix] the shop's sign-in token was rejected (expired or invalid); chatting as a guest"

/** The one-off recoveries a turn may still make. */
interface Recoveries {
  staleConversation: boolean
  guest: boolean
}

export function useChat({ api, widgetKey, identity }: { api: WidgetApi; widgetKey: string; identity: Identity }) {
  // A conversation never changes owner. loadHistory returns this tab's transcript only to its owner;
  // a stored session for someone else is left alone, and runTurn ignores it.
  let nextId = 1
  const messages: Ref<WidgetMessage[]> = ref(
    loadHistory(widgetKey, identity.customerId).map((m) => ({ ...m, id: nextId++, status: 'done' as const })),
  )
  const busy = ref(false)
  let controller: AbortController | null = null
  /** True while a rejected token is dropped, so that switch to a guest does not wipe the turn being resent. */
  let droppingToken = false

  // Sign-in, sign-out or another shopper: switch at once (sync), before anything else can be sent.
  watch(
    () => identity.customerId,
    (next, prev) => {
      if (!droppingToken) switchShopper(next, prev)
    },
    { flush: 'sync' },
  )

  /**
   * The previous identity is gone from this tab: abort its reply and delete what it owned. The new identity gets its
   * own stored conversation back if there is one (a shop that identifies after the widget mounted as a guest), and
   * otherwise starts empty. Anything stored for a third person is left alone.
   */
  function switchShopper(next: string | null, prev: string | null): void {
    controller?.abort()
    controller = null
    busy.value = false
    clearOwnedBy(widgetKey, prev)
    messages.value = loadHistory(widgetKey, next).map((m) => ({ ...m, id: nextId++, status: 'done' as const }))
  }

  function persist() {
    saveHistory(widgetKey, {
      customerId: identity.customerId,
      messages: messages.value.filter((m) => m.status === 'done').map(({ role, content, tools }) => ({ role, content, tools })),
    })
  }

  /** The reactive copy of the reply bubble, so in-place updates re-render. */
  function bubble(id: number): WidgetMessage | undefined {
    return messages.value.find((m) => m.id === id)
  }

  function fail(id: number, error: string) {
    const m = bubble(id)
    if (!m) return
    m.status = 'error'
    m.error = error
  }

  /** Drops a token the gateway rejected and keeps only this turn: earlier ones belonged to the signed-in shopper. */
  function continueAsGuest(replyId: number) {
    droppingToken = true
    try {
      identity.token = null
      identity.customerId = null
    } finally {
      droppingToken = false
    }
    console.warn(TOKEN_REJECTED)
    clearSession(widgetKey)
    const at = messages.value.findIndex((m) => m.id === replyId)
    if (at > 0) messages.value = messages.value.slice(at - 1)
  }

  async function runTurn(text: string, replyId: number, signal: AbortSignal, can: Recoveries): Promise<void> {
    const owner = identity.customerId
    const saved = loadSession(widgetKey)
    // Another tab may have stored a conversation for someone else: never continue it as this shopper.
    const session = saved && saved.customerId === owner ? saved : null
    const body: SendBody = { message: text }
    if (session) {
      body.conversationId = session.conversationId
      if (session.sessionToken) body.sessionToken = session.sessionToken
    }
    // The token this request carries: a 401 only condemns it if the storefront has not replaced it since.
    const sentToken = identity.token
    const res = await api.sendMessage(body, signal)
    if (!res.ok) {
      const err = await readApiError(res)
      if (signal.aborted) return
      // A stored conversation can disappear (database reset, storage copied between browsers): start over once.
      if (err.status === 404 && err.code === 'conversation_not_found' && session && can.staleConversation) {
        clearSession(widgetKey)
        return runTurn(text, replyId, signal, { ...can, staleConversation: false })
      }
      // An expired or rejected shop token must never break chat: drop it and resend this message as a guest, once.
      if (err.status === 401 && err.code === 'invalid_customer_token' && sentToken && can.guest) {
        // Refreshed meanwhile: the rejected token is already gone, so retry once with the current one.
        if (identity.token !== sentToken) return runTurn(text, replyId, signal, { staleConversation: false, guest: false })
        continueAsGuest(replyId)
        return runTurn(text, replyId, signal, { staleConversation: false, guest: false })
      }
      return fail(replyId, err.message)
    }
    let sessionToken = session?.sessionToken ?? null
    for await (const e of chatEvents(res)) {
      // newChat() aborts the turn and drops the bubble: nothing from a late event may touch state or storage.
      if (signal.aborted) return
      const reply = bubble(replyId)
      if (!reply) return
      if (e.event === 'meta') {
        sessionToken = e.data.sessionToken ?? sessionToken
        saveSession(widgetKey, { conversationId: e.data.conversationId, sessionToken, customerId: owner })
      } else if (e.event === 'delta') {
        reply.content += e.data.text
      } else if (e.event === 'tool') {
        reply.tools.push(e.data)
      } else if (e.event === 'done') {
        reply.status = 'done'
        persist()
        return
      } else if (e.event === 'error') {
        return fail(replyId, e.data.message)
      }
    }
    if (!signal.aborted) fail(replyId, CUT_OFF)
  }

  async function start(text: string) {
    const reply: WidgetMessage = { id: nextId++, role: 'assistant', content: '', tools: [], status: 'streaming' }
    messages.value.push(reply)
    busy.value = true
    const ctrl = new AbortController()
    controller = ctrl
    try {
      await runTurn(text, reply.id, ctrl.signal, { staleConversation: true, guest: true })
    } catch {
      if (!ctrl.signal.aborted && messages.value.some((m) => m.id === reply.id)) fail(reply.id, NETWORK_ERROR)
    } finally {
      if (controller === ctrl) {
        controller = null
        busy.value = false
      }
    }
  }

  async function send(raw: string): Promise<void> {
    const text = raw.trim().slice(0, CHAT_MESSAGE_MAX)
    if (!text || busy.value) return
    messages.value.push({ id: nextId++, role: 'user', content: text, tools: [], status: 'done' })
    await start(text)
  }

  /** Resends the user message behind the last failed reply. The server stored nothing for the failed turn. */
  async function retry(): Promise<void> {
    const last = messages.value.at(-1)
    const user = messages.value.at(-2)
    if (busy.value || last?.status !== 'error' || user?.role !== 'user') return
    messages.value.pop()
    await start(user.content)
  }

  function newChat(): void {
    controller?.abort()
    controller = null
    busy.value = false
    messages.value = []
    clearSession(widgetKey)
  }

  return { messages, busy, send, retry, newChat }
}
