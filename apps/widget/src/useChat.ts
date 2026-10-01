import { ref, type Ref } from 'vue'
import type { ChatToolEvent } from '@helpix/shared/api-types'
import { CHAT_MESSAGE_MAX, chatEvents } from '@helpix/shared/chat'
import { readApiError, type SendBody, type WidgetApi } from './api'
import { clearSession, loadHistory, loadSession, saveHistory, saveSession } from './storage'

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

export function useChat({ api, widgetKey }: { api: WidgetApi; widgetKey: string }) {
  let nextId = 1
  const messages: Ref<WidgetMessage[]> = ref(
    loadHistory(widgetKey).map((m) => ({ ...m, id: nextId++, status: 'done' as const })),
  )
  const busy = ref(false)
  let controller: AbortController | null = null

  function persist() {
    saveHistory(
      widgetKey,
      messages.value.filter((m) => m.status === 'done').map(({ role, content, tools }) => ({ role, content, tools })),
    )
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

  async function runTurn(text: string, replyId: number, signal: AbortSignal, allowFreshStart: boolean): Promise<void> {
    const session = loadSession(widgetKey)
    const body: SendBody = { message: text }
    if (session) {
      body.conversationId = session.conversationId
      if (session.sessionToken) body.sessionToken = session.sessionToken
    }
    const res = await api.sendMessage(body, signal)
    if (!res.ok) {
      const err = await readApiError(res)
      // A stored conversation can disappear (database reset, storage copied between browsers): start over once.
      if (err.status === 404 && err.code === 'conversation_not_found' && session && allowFreshStart) {
        clearSession(widgetKey)
        return runTurn(text, replyId, signal, false)
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
        saveSession(widgetKey, { conversationId: e.data.conversationId, sessionToken })
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
      await runTurn(text, reply.id, ctrl.signal, true)
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
