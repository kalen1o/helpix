<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { ConversationListResponse, ConversationSummary } from '@helpix/shared/api-types'
import { Button, Card, EmptyState, PageHeader, SegmentedControl, type SegmentedOption, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, vEnter } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { customerLabel } from '@/lib/chat'
import { formatDateTime } from '@/lib/format'

type Kind = 'real' | 'playground'
const KINDS: SegmentedOption<Kind>[] = [
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
    <PageHeader title="Conversations" description="Every chat with the agent, with the documents it used for each reply.">
      <template #actions>
        <SegmentedControl v-model="kind" :options="KINDS" label="Conversation type" />
      </template>
    </PageHeader>

    <p v-if="error && items.length === 0" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <Card v-if="loaded && (!error || items.length > 0)" v-enter="0" class="gap-0 overflow-hidden py-0">
      <EmptyState v-if="items.length === 0" :title="EMPTY[kind].title" :description="EMPTY[kind].description" />
      <div v-else class="relative overflow-x-auto overflow-y-hidden">
        <Table>
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead class="pl-6">Who</TableHead>
              <TableHead>First message</TableHead>
              <TableHead class="text-right">Messages</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead class="w-10 pr-6"><span class="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <!-- The name link stretches over the whole row, so rows are clickable and keyboard-reachable. -->
            <TableRow
              v-for="(c, i) in items"
              :key="c.id"
              v-enter="i + 1"
              class="group relative hover:bg-muted/50 focus-within:bg-muted/50"
            >
              <TableCell class="py-3 pl-6">
                <RouterLink
                  :to="`/conversations/${c.id}`"
                  class="whitespace-nowrap font-medium after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {{ customerLabel(c) }}
                </RouterLink>
              </TableCell>
              <TableCell class="max-w-80">
                <p class="truncate text-muted-foreground" :title="c.preview">{{ c.preview }}</p>
              </TableCell>
              <TableCell class="text-right font-mono text-xs tabular-nums text-muted-foreground">{{ c.messageCount }}</TableCell>
              <TableCell class="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{{ formatDateTime(c.updatedAt) }}</TableCell>
              <TableCell class="pr-6 text-muted-foreground">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  class="size-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                ><path d="m9 18 6-6-6-6" /></svg>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>

    <p v-if="error && items.length > 0" class="text-center text-sm text-destructive" role="alert">{{ error }}</p>
    <div v-if="nextBefore" class="flex justify-center">
      <Button variant="outline" :disabled="loadingMore" @click="load(true)">{{ loadingMore ? 'Loading…' : 'Load more' }}</Button>
    </div>
  </div>
</template>
