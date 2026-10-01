<script setup lang="ts">
import { computed } from 'vue'
import { chipsFor } from '@helpix/shared/chat'
import type { WidgetMessage } from '../useChat'

const props = defineProps<{ message: WidgetMessage }>()
defineEmits<{ retry: [] }>()
const chips = computed(() => chipsFor(props.message.tools).filter((c) => c.tone === 'source'))
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
    <ul v-if="chips.length" class="flex max-w-[85%] flex-wrap gap-1.5" aria-label="Sources">
      <li v-for="chip in chips" :key="chip.key" class="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground" :title="`Source: ${chip.label}`">
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
