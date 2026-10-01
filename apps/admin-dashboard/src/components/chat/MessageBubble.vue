<script setup lang="ts">
import type { ChatRole, ChatToolEvent } from '@helpix/shared/api-types'
import ToolChips from './ToolChips.vue'

defineProps<{ role: ChatRole; content: string; tools?: ChatToolEvent[]; pending?: boolean; meta?: string }>()
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="role === 'user' ? 'items-end' : 'items-start'" :data-role="role">
    <!-- Plain text only: replies are never rendered as HTML. Agent bubbles use the Mint wash, customer bubbles Ink. -->
    <div
      v-if="content || pending"
      class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
      :class="role === 'user' ? 'rounded-br-md bg-foreground text-background' : 'rounded-bl-md bg-secondary text-secondary-foreground'"
    >
      <template v-if="content">{{ content }}</template>
      <span v-else class="inline-flex gap-1 py-1" role="status" aria-label="The agent is typing">
        <span v-for="i in 3" :key="i" class="size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-pulse" :style="{ animationDelay: `${i * 150}ms` }" />
      </span>
    </div>
    <ToolChips v-if="tools?.length" :tools="tools" />
    <p v-if="meta" class="text-[11px] text-muted-foreground">{{ meta }}</p>
    <slot name="footer" />
  </div>
</template>
