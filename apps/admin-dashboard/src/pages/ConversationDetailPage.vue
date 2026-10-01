<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { ConversationDetail, ToolActivity } from '@helpix/shared/api-types'
import { Badge, Card, CardContent } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import { customerLabel, toChatToolEvent } from '@/lib/chat'
import { formatDateTime } from '@/lib/format'

const route = useRoute()
const detail = ref<ConversationDetail | null>(null)
const error = ref<string | null>(null)

const queryOf = (t: ToolActivity): string | null => (typeof t.arguments?.query === 'string' ? t.arguments.query : null)
const outcome = (t: ToolActivity): string =>
  t.status === 'ok'
    ? `${t.results.length} result${t.results.length === 1 ? '' : 's'}`
    : t.status === 'empty'
      ? 'nothing relevant'
      : (t.error ?? 'failed')
const excerpt = (text: string) => (text.length > 160 ? `${text.slice(0, 160)}…` : text)

onMounted(async () => {
  try {
    detail.value = await api.get<ConversationDetail>(`/chat/conversations/${encodeURIComponent(String(route.params.id))}`)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) error.value = 'This conversation does not exist.'
    else error.value = e instanceof ApiError ? e.message : 'Could not load the conversation'
  }
})
</script>

<template>
  <div class="grid gap-6">
    <RouterLink to="/conversations" class="w-fit text-sm text-muted-foreground hover:text-foreground">← Conversations</RouterLink>
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <template v-if="detail">
      <div class="grid gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-semibold">{{ customerLabel(detail.conversation) }}</h1>
          <Badge v-if="detail.conversation.isPlayground" variant="secondary">Playground</Badge>
        </div>
        <p class="text-sm text-muted-foreground">
          Started {{ formatDateTime(detail.conversation.createdAt) }} · {{ detail.conversation.messageCount }} messages
        </p>
      </div>

      <Card>
        <CardContent class="grid gap-4">
          <MessageBubble
            v-for="m in detail.messages"
            :key="m.id"
            :role="m.role"
            :content="m.content"
            :tools="m.tools.map((t) => toChatToolEvent(t))"
            :meta="m.model ? `${formatDateTime(m.createdAt)} · ${m.model}` : formatDateTime(m.createdAt)"
          >
            <template v-if="m.tools.length" #footer>
              <details class="max-w-[85%] text-xs text-muted-foreground">
                <summary class="cursor-pointer select-none hover:text-foreground">What the agent looked up</summary>
                <ul class="mt-2 grid gap-2">
                  <li v-for="(t, i) in m.tools" :key="i" class="grid gap-1 rounded-md border p-2">
                    <span>
                      <span class="font-mono">{{ t.name }}</span>
                      <template v-if="queryOf(t)"> “{{ queryOf(t) }}”</template>
                      · {{ outcome(t) }}
                    </span>
                    <span v-for="r in t.results" :key="`${r.documentId}:${r.position}`" class="text-foreground/80">
                      <span class="font-medium">{{ r.title }}</span> <span class="tabular-nums">({{ r.score.toFixed(2) }})</span>:
                      {{ excerpt(r.text) }}
                    </span>
                  </li>
                </ul>
              </details>
            </template>
          </MessageBubble>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
