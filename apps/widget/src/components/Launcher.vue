<script setup lang="ts">
import { ref } from 'vue'
import { HelpixLogo } from '@helpix/ui'

defineProps<{ open: boolean; color: string; controls: string }>()
defineEmits<{ toggle: [] }>()

const button = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => button.value?.focus() })
</script>

<template>
  <!-- 56 px, 16 px from the corner, white 28 px mark on the shop's accent (DESIGN.md "Chat surfaces"). -->
  <button
    ref="button"
    type="button"
    data-helpix-launcher
    :aria-controls="controls"
    :aria-label="open ? 'Close chat' : 'Open chat'"
    :aria-expanded="open"
    class="fixed bottom-4 right-4 z-[2147483000] grid size-14 place-items-center rounded-full text-white shadow-[0_8px_24px_-6px_rgb(12_154_130/0.45)] transition-transform duration-150 ease-out hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 motion-reduce:transition-none"
    :class="open && 'max-[480px]:hidden'"
    :style="{ backgroundColor: color }"
    @click="$emit('toggle')"
  >
    <svg v-if="open" viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
    <HelpixLogo v-else mark-only class="size-7 text-white" aria-hidden="true" />
  </button>
</template>
