<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { ConversationDetail, ToolActivity } from '@helpix/shared/api-types'
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, StatPanel, vEnter } from '@helpix/ui'
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

const lookups = computed(() => detail.value?.messages.flatMap((m) => m.tools) ?? [])
/** Every document the agent's searches returned, once, in first-seen order. */
const sources = computed(() => {
  const seen = new Map<string, string>()
  for (const t of lookups.value) for (const r of t.results) if (!seen.has(r.documentId)) seen.set(r.documentId, r.title)
  return [...seen].map(([id, title]) => ({ id, title }))
})

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
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <RouterLink
      v-if="!detail"
      to="/conversations"
      class="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4"><path d="m15 18-6-6 6-6" /></svg>
      Conversations
    </RouterLink>

    <template v-if="detail">
      <PageHeader :title="customerLabel(detail.conversation)">
        <template #eyebrow>
          <RouterLink
            to="/conversations"
            class="mb-2 inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4"><path d="m15 18-6-6 6-6" /></svg>
            Conversations
          </RouterLink>
        </template>
        <template v-if="detail.conversation.isPlayground" #badge>
          <Badge variant="secondary">Playground</Badge>
        </template>
        <template #description>
          Started <span class="font-mono text-xs tabular-nums">{{ formatDateTime(detail.conversation.createdAt) }}</span>
        </template>
      </PageHeader>

      <div class="grid items-start gap-6 lg:grid-cols-3">
        <Card v-enter="0" class="lg:col-span-2">
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
                  <summary class="w-fit cursor-pointer select-none rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    What the agent looked up
                  </summary>
                  <ul class="mt-2 grid gap-2">
                    <li v-for="(t, i) in m.tools" :key="i" class="grid gap-1.5 rounded-lg border bg-muted/50 p-3">
                      <span>
                        <span class="font-mono uppercase tracking-[0.08em] text-[11px]">{{ t.name }}</span>
                        <template v-if="queryOf(t)"> “{{ queryOf(t) }}”</template>
                        · {{ outcome(t) }}
                      </span>
                      <span v-for="r in t.results" :key="`${r.documentId}:${r.position}`" class="text-foreground/80">
                        <span class="font-medium">{{ r.title }}</span> <span class="font-mono tabular-nums">({{ r.score.toFixed(2) }})</span>:
                        {{ excerpt(r.text) }}
                      </span>
                    </li>
                  </ul>
                </details>
              </template>
            </MessageBubble>
          </CardContent>
        </Card>

        <aside class="grid gap-4 sm:grid-cols-3 lg:grid-cols-1" aria-label="Conversation summary">
          <StatPanel v-enter="1" label="Messages" :value="detail.conversation.messageCount" emphasis />
          <StatPanel v-enter="2" label="KB lookups" :value="lookups.length" :caption="lookups.length === 0 ? 'answered without searching' : undefined" />
          <StatPanel v-enter="3" label="Sources cited" :value="sources.length" />
          <Card v-if="sources.length" v-enter="4" class="gap-3 py-4 sm:col-span-3 lg:col-span-1">
            <CardHeader class="px-4">
              <CardTitle class="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Documents used</CardTitle>
            </CardHeader>
            <CardContent class="px-4">
              <ul class="grid gap-1.5 text-sm">
                <li v-for="src in sources" :key="src.id" class="truncate" :title="src.title">{{ src.title }}</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </template>
  </div>
</template>
