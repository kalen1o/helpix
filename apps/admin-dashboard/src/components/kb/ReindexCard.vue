<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { KbReindexStatus } from '@helpix/shared/api-types'
import { motion } from 'motion-v'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, SPRING } from '@helpix/ui'
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
    <CardHeader class="grid-cols-[1fr_auto] items-start gap-x-4">
      <div class="grid gap-1.5">
        <CardTitle>Search index</CardTitle>
        <CardDescription>
          Documents are embedded with the platform's embedding model. When the model changes, re-index so every document is
          searchable again.
        </CardDescription>
      </div>
      <Button v-if="status" variant="outline" size="sm" :disabled="status.running || starting || upToDate" @click="start">
        {{ status.running ? 'Re-indexing…' : 'Re-index' }}
      </Button>
    </CardHeader>
    <CardContent class="grid gap-3">
      <div v-if="status" class="grid gap-3 rounded-lg border bg-muted/50 p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p class="text-sm">{{ reindexSummary(status) }}</p>
          <p class="font-mono text-xs text-muted-foreground">Model: {{ status.model }}</p>
        </div>
        <div
          class="h-1.5 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-label="Re-index progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="reindexPercent(status)"
        >
          <!-- scaleX, not width: the bar moves on the compositor and a new poll re-targets it mid-flight. -->
          <motion.div
            class="h-full origin-left rounded-full bg-primary"
            :initial="false"
            :animate="{ scaleX: reindexPercent(status) / 100 }"
            :transition="SPRING"
          />
        </div>
      </div>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    </CardContent>
  </Card>
</template>
