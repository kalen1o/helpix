<script setup lang="ts">
import { computed } from 'vue'
import type { ChatToolEvent } from '@helpix/shared/api-types'
import { Badge } from '@helpix/ui'
import { chipsFor } from '@/lib/chat'

const props = defineProps<{ tools: ChatToolEvent[] }>()
const chips = computed(() => chipsFor(props.tools))
const VARIANT = { source: 'positive', empty: 'outline', error: 'negative', order: 'secondary' } as const
</script>

<template>
  <ul v-if="chips.length" class="flex max-w-[85%] flex-wrap gap-1.5" aria-label="What the agent checked">
    <li v-for="chip in chips" :key="chip.key">
      <Badge :variant="VARIANT[chip.tone]" :title="chip.tone === 'source' ? `Source: ${chip.label}` : undefined">{{ chip.label }}</Badge>
    </li>
  </ul>
</template>
