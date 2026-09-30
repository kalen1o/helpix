<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { onBeforeUnmount, ref } from 'vue'
import { cn } from '../lib/utils'
import Button from './Button.vue'

const props = defineProps<{ value: string; class?: ClassValue }>()

type State = 'idle' | 'copied' | 'failed'
const state = ref<State>('idle')
let resetTimer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  clearTimeout(resetTimer)
  try {
    await navigator.clipboard.writeText(props.value)
    state.value = 'copied'
  } catch {
    state.value = 'failed'
  }
  resetTimer = setTimeout(() => (state.value = 'idle'), 1500)
}

onBeforeUnmount(() => clearTimeout(resetTimer))

// The button has a fixed width (w-28) so the label change never shifts the layout.
const LABELS: Record<State, string> = { idle: 'Copy', copied: 'Copied', failed: 'Copy failed' }
</script>

<template>
  <Button variant="outline" size="sm" :class="cn('w-28', props.class)" :data-state="state" @click="copy">
    <span class="relative size-3.5" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        :class="cn('absolute inset-0 size-3.5 transition-[opacity,transform] duration-150 ease-out', state === 'copied' ? 'scale-75 opacity-0' : 'scale-100 opacity-100')"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        :class="cn('absolute inset-0 size-3.5 text-primary transition-[opacity,transform] duration-150 ease-out', state === 'copied' ? 'scale-100 opacity-100' : 'scale-75 opacity-0')"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
    <span aria-live="polite">{{ LABELS[state] }}</span>
  </Button>
</template>
