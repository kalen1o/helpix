<script setup lang="ts">
import type { ChatRole, ChatToolEvent } from '@helpix/shared/api-types'
import { motion } from 'motion-v'
import { SPRING } from '@helpix/ui'
import ToolChips from './ToolChips.vue'

defineProps<{
  role: ChatRole
  content: string
  tools?: ChatToolEvent[]
  pending?: boolean
  meta?: string
  /** Animate in on mount (live chat). Transcripts render still. */
  appear?: boolean
}>()
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="role === 'user' ? 'items-end' : 'items-start'" :data-role="role">
    <!-- Plain text only: replies are never rendered as HTML. Agent bubbles use the Mint wash, customer bubbles Ink.
         A new bubble grows out of its tight corner, the side its speaker sits on. -->
    <motion.div
      v-if="content || pending"
      :initial="appear ? { opacity: 0, scale: 0.94 } : false"
      :animate="{ opacity: 1, scale: 1 }"
      :transition="SPRING"
      :style="{ transformOrigin: role === 'user' ? '100% 100%' : '0% 100%' }"
      class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
      :class="role === 'user' ? 'rounded-br-md bg-foreground text-background' : 'rounded-bl-md bg-secondary text-secondary-foreground'"
    >
      <template v-if="content">{{ content }}</template>
      <span v-else class="inline-flex gap-1 py-1" role="status" aria-label="The agent is typing">
        <span v-for="i in 3" :key="i" class="size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-pulse" :style="{ animationDelay: `${i * 150}ms` }" />
      </span>
    </motion.div>
    <ToolChips v-if="tools?.length" :tools="tools" />
    <p v-if="meta" class="font-mono text-[11px] tabular-nums text-muted-foreground">{{ meta }}</p>
    <slot name="footer" />
  </div>
</template>
