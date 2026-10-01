<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { KbReindexStatus } from '@helpix/shared/api-types'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { reindexPercent, reindexSummary } from '@/lib/kb'
import { usePolling } from '@/lib/polling'

const status = ref<KbReindexStatus | null>(null)
const error = ref<string | null>(null)
const starting = ref(false)

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)
const upToDate = computed(() => status.value !== null && status.value.done === status.value.total)

async function refresh() {
  try {
    status.value = await api.get<KbReindexStatus>('/kb/reindex')
    error.value = null
  } catch (e) {
    error.value = message(e, 'Could not load the index status')
  }
}

async function start() {
  starting.value = true
  error.value = null
  try {
    status.value = await api.post<KbReindexStatus>('/kb/reindex')
  } catch (e) {
    error.value = message(e, 'Could not start re-indexing')
  } finally {
    starting.value = false
  }
}

usePolling(refresh, 2000, computed(() => status.value?.running === true))
onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Search index</CardTitle>
      <CardDescription>
        Documents are embedded with the platform's embedding model. When the model changes, re-index so every document is
        searchable again.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-3">
      <template v-if="status">
        <div
          class="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Re-index progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="reindexPercent(status)"
        >
          <div class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" :style="{ width: `${reindexPercent(status)}%` }" />
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-muted-foreground">{{ reindexSummary(status) }}</p>
          <Button variant="outline" size="sm" :disabled="status.running || starting || upToDate" @click="start">
            {{ status.running ? 'Re-indexing…' : 'Re-index' }}
          </Button>
        </div>
        <p class="font-mono text-xs text-muted-foreground">Model: {{ status.model }}</p>
      </template>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    </CardContent>
  </Card>
</template>
