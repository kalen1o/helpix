<script setup lang="ts">
import { computed } from 'vue'
import { chipsFor, type Chip } from '@helpix/shared/chat'
import type { WidgetMessage } from '../useChat'

const props = defineProps<{ message: WidgetMessage }>()
defineEmits<{ retry: [] }>()
// Shoppers see cited documents but not "nothing found" or failed KB searches: the reply text covers those.
// Order lookups are different: the order chip, "Order not found", "No orders yet" and "Couldn't check your order" are all shown.
// Chips are split by tool name, not by chip key, so the shared key format can change freely.
const sourceChips = computed(() => chipsFor(props.message.tools.filter((t) => t.name !== 'lookup_order')).filter((c) => c.tone === 'source'))
const orderChips = computed(() => chipsFor(props.message.tools.filter((t) => t.name === 'lookup_order')))
const ORDER_TONE: Record<Chip['tone'], string> = {
  order: 'border-border bg-card text-foreground',
  source: 'border-border bg-card text-muted-foreground',
  empty: 'border-border bg-card text-muted-foreground',
  error: 'border-destructive/30 bg-card text-destructive',
}
const typing = computed(() => props.message.status === 'streaming' && !props.message.content)
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="message.role === 'user' ? 'items-end' : 'items-start'" :data-role="message.role">
    <!-- Plain text only: replies are never rendered as HTML. -->
    <div
      v-if="message.content || typing"
      class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
      :class="message.role === 'user' ? 'rounded-br-md bg-foreground text-background' : 'rounded-bl-md bg-secondary text-secondary-foreground'"
    >
      <template v-if="message.content">{{ message.content }}</template>
      <span v-else class="inline-flex gap-1 py-1" role="status" aria-label="The assistant is typing">
        <span v-for="i in 3" :key="i" class="size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-pulse" :style="{ animationDelay: `${i * 150}ms` }" />
      </span>
    </div>
    <ul v-if="orderChips.length" class="flex max-w-[85%] flex-wrap gap-1.5" aria-label="Orders">
      <li v-for="chip in orderChips" :key="chip.key" class="rounded-md border px-2 py-0.5 text-[11px] font-medium" :class="ORDER_TONE[chip.tone]">
        {{ chip.label }}
      </li>
    </ul>
    <ul v-if="sourceChips.length" class="flex max-w-[85%] flex-wrap gap-1.5" aria-label="Sources">
      <li v-for="chip in sourceChips" :key="chip.key" class="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground" :title="`Source: ${chip.label}`">
        {{ chip.label }}
      </li>
    </ul>
    <p v-if="message.status === 'error'" class="flex max-w-[85%] items-center gap-2 text-xs text-destructive" role="alert">
      <span>{{ message.error }}</span>
      <button type="button" data-helpix-retry class="rounded-md font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring" @click="$emit('retry')">
        Try again
      </button>
    </p>
  </div>
</template>
