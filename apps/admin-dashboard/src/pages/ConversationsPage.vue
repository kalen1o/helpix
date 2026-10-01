<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { ConversationListResponse, ConversationSummary } from '@helpix/shared/api-types'
import { Button, Card, CardContent, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api, session } from '@/auth/session'
import { customerLabel } from '@/lib/chat'
import { formatDateTime } from '@/lib/format'

type Kind = 'real' | 'playground'
const KINDS: { value: Kind; label: string }[] = [
  { value: 'real', label: 'Customers' },
  { value: 'playground', label: 'Playground' },
]
const EMPTY: Record<Kind, { title: string; description: string }> = {
  real: { title: 'No conversations yet', description: "Chats from your shop's widget will show up here." },
  playground: { title: 'No test chats yet', description: 'Chats from the playground on the Agent page show up here.' },
}

const kind = ref<Kind>('real')
const items = ref<ConversationSummary[]>([])
const nextBefore = ref<string | null>(null)
const loaded = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
// Bumped on every load, so a slow response for the other tab cannot overwrite this one.
let generation = 0

async function load(more = false) {
  const started = ++generation
  const params = new URLSearchParams({ kind: kind.value })
  if (more && nextBefore.value) params.set('before', nextBefore.value)
  loadingMore.value = more
  error.value = null
  try {
    const res = await api.get<ConversationListResponse>(`/chat/conversations?${params}`)
    if (started !== generation) return
    items.value = more ? [...items.value, ...res.conversations] : res.conversations
    nextBefore.value = res.nextBefore
  } catch (e) {
    if (started === generation) error.value = e instanceof ApiError ? e.message : 'Could not load conversations'
  } finally {
    if (started === generation) {
      loaded.value = true
      loadingMore.value = false
    }
  }
}

watch(kind, () => {
  items.value = []
  nextBefore.value = null
  loaded.value = false
  void load()
})
onMounted(() => load())
</script>

<template>
  <div class="grid gap-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="grid gap-1">
        <p class="text-sm text-muted-foreground">{{ session.state.me?.tenant?.name }}</p>
        <h1 class="text-2xl font-semibold">Conversations</h1>
        <p class="text-sm text-muted-foreground">Every chat with the agent, with the documents it used for each reply.</p>
      </div>
      <div role="group" aria-label="Conversation type" class="inline-flex rounded-md border p-0.5 text-sm">
        <button
          v-for="k in KINDS"
          :key="k.value"
          type="button"
          :aria-pressed="kind === k.value"
          class="rounded px-3 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="kind === k.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="kind = k.value"
        >
          {{ k.label }}
        </button>
      </div>
    </div>

    <p v-if="error && items.length === 0" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <Card v-if="loaded && (!error || items.length > 0)" class="py-0">
      <CardContent class="px-0">
        <EmptyState v-if="items.length === 0" :title="EMPTY[kind].title" :description="EMPTY[kind].description" />
        <Table v-else>
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead class="pl-6">Who</TableHead>
              <TableHead>First message</TableHead>
              <TableHead class="text-right">Messages</TableHead>
              <TableHead class="pr-6">Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="c in items" :key="c.id">
              <TableCell class="py-3 pl-6">
                <RouterLink
                  :to="`/conversations/${c.id}`"
                  class="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {{ customerLabel(c) }}
                </RouterLink>
              </TableCell>
              <TableCell class="max-w-80">
                <p class="truncate text-muted-foreground" :title="c.preview">{{ c.preview }}</p>
              </TableCell>
              <TableCell class="text-right tabular-nums text-muted-foreground">{{ c.messageCount }}</TableCell>
              <TableCell class="whitespace-nowrap pr-6 text-muted-foreground">{{ formatDateTime(c.updatedAt) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <p v-if="error && items.length > 0" class="text-center text-sm text-destructive" role="alert">{{ error }}</p>
    <div v-if="nextBefore" class="flex justify-center">
      <Button variant="outline" :disabled="loadingMore" @click="load(true)">{{ loadingMore ? 'Loading…' : 'Load more' }}</Button>
    </div>
  </div>
</template>
