<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import type { AgentConfig, ChatRole, ChatToolEvent } from '@helpix/shared/api-types'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, prefersReducedMotion, Textarea } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import { CHAT_MESSAGE_MAX, chatEvents } from '@/lib/chat'

const props = defineProps<{ config: AgentConfig; disabled?: boolean }>()

interface Turn {
  id: number
  role: ChatRole
  content: string
  tools: ChatToolEvent[]
  pending: boolean
  error: string | null
}

const turns = ref<Turn[]>([])
const draft = ref('')
const customerId = ref('')
const conversationId = ref<string | null>(null)
const sending = ref(false)
const list = ref<HTMLElement | null>(null)
let controller: AbortController | null = null
let nextId = 0
let lastMessage = ''

/** Glide to a new message; while a reply streams, follow it instantly so the scroll never lags the text. */
async function scrollToEnd(smooth = false) {
  await nextTick()
  const el = list.value
  if (!el) return
  if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
  else el.scrollTop = el.scrollHeight
}

async function send(text = draft.value.trim()) {
  if (!text || sending.value || props.disabled) return
  lastMessage = text
  draft.value = ''
  turns.value.push({ id: nextId++, role: 'user', content: text, tools: [], pending: false, error: null })
  turns.value.push({ id: nextId++, role: 'assistant', content: '', tools: [], pending: true, error: null })
  // The reactive proxy, so the template follows the updates below.
  const reply = turns.value[turns.value.length - 1]!
  void scrollToEnd(true)

  const ac = new AbortController()
  controller = ac
  sending.value = true
  let finished = false
  try {
    const res = await api.stream(
      '/chat/playground',
      {
        message: text,
        // A snapshot: edits made while the reply streams apply to the next message.
        config: { ...props.config },
        customerId: customerId.value.trim() || null,
        ...(conversationId.value ? { conversationId: conversationId.value } : {}),
      },
      ac.signal,
    )
    for await (const ev of chatEvents(res)) {
      if (ac.signal.aborted) break
      if (ev.event === 'meta') conversationId.value = ev.data.conversationId
      else if (ev.event === 'delta') reply.content += ev.data.text
      else if (ev.event === 'tool') reply.tools.push(ev.data)
      else if (ev.event === 'error') reply.error = ev.data.message
      else if (ev.event === 'done') finished = true
      void scrollToEnd()
    }
    if (!finished && !reply.error) reply.error = 'The reply was cut off. Try again.'
  } catch (e) {
    if (ac.signal.aborted) return
    reply.error = e instanceof ApiError ? e.message : 'Could not reach the agent.'
    // A test chat that no longer exists: the next message starts a new one.
    if (e instanceof ApiError && e.status === 404) conversationId.value = null
  } finally {
    reply.pending = false
    if (controller === ac) {
      controller = null
      sending.value = false
    }
  }
}

/** A failed exchange is not stored by the server, so drop it here and send the same message again. */
function retry() {
  if (props.disabled) return
  turns.value.splice(-2, 2)
  void send(lastMessage)
}

function newChat() {
  controller?.abort()
  controller = null
  sending.value = false
  turns.value = []
  conversationId.value = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <Card class="lg:sticky lg:top-20">
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div class="grid gap-1.5">
          <CardTitle>Playground</CardTitle>
          <CardDescription>
            Chat with the agent using the settings on this page, saved or not. Test chats are kept apart from customer conversations.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" :disabled="turns.length === 0" @click="newChat">New chat</Button>
      </div>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div
        ref="list"
        class="grid max-h-[28rem] min-h-56 content-start gap-3 overflow-y-auto overscroll-contain rounded-lg border bg-background p-3"
        aria-live="polite"
        aria-label="Playground conversation"
      >
        <p v-if="turns.length === 0" class="m-auto max-w-64 py-12 text-center text-sm text-muted-foreground">
          Ask what a customer would, like “Can I return an opened item?”
        </p>
        <MessageBubble v-for="t in turns" :key="t.id" :role="t.role" :content="t.content" :tools="t.tools" :pending="t.pending" appear>
          <template v-if="t.error" #footer>
            <p class="max-w-[85%] text-xs text-destructive" role="alert">{{ t.error }}</p>
            <Button v-if="t.id === turns[turns.length - 1]?.id && !sending && !disabled" variant="outline" size="sm" @click="retry">Try again</Button>
          </template>
        </MessageBubble>
      </div>

      <form class="grid gap-2" @submit.prevent="send()">
        <Label for="playground-message" class="sr-only">Message</Label>
        <Textarea
          id="playground-message"
          v-model="draft"
          rows="2"
          class="min-h-0 resize-none"
          :maxlength="CHAT_MESSAGE_MAX"
          :disabled="disabled"
          placeholder="Type a customer question…"
          @keydown="onKeydown"
        />
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-muted-foreground">
            {{ disabled ? 'Fix the settings to test them.' : 'Enter to send, Shift+Enter for a new line.' }}
          </p>
          <Button type="submit" size="sm" :disabled="disabled || sending || !draft.trim()">Send</Button>
        </div>
      </form>

      <div class="grid gap-1.5">
        <Label for="playground-customer">Test customer ID <span class="font-normal text-muted-foreground">(optional)</span></Label>
        <Input id="playground-customer" v-model="customerId" maxlength="200" class="font-mono" placeholder="cust_1001" />
        <p class="text-xs text-muted-foreground">Order lookups will use this ID once your shop's order API is connected.</p>
      </div>
    </CardContent>
  </Card>
</template>
