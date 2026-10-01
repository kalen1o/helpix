<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed, type Component } from 'vue'
import { cn } from '../lib/utils'

const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    caption?: string
    /** The one headline metric on the page gets Mint. Everything else stays Ink. */
    emphasis?: boolean
    /** A count that signals trouble (failed, suspended) when it is above zero. */
    negative?: boolean
    /** Render as a link or button (e.g. RouterLink); the panel then lifts on hover. */
    as?: string | Component
    class?: ClassValue
  }>(),
  { as: 'div' },
)

const interactive = computed(() => props.as !== 'div')
</script>

<template>
  <component
    :is="props.as"
    :class="cn(
      'grid content-start gap-1 rounded-xl border bg-card p-4 text-card-foreground shadow-sm',
      interactive && [
        'transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none',
      ],
      props.class,
    )"
  >
    <span class="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{{ props.label }}</span>
    <span
      class="font-display text-3xl font-bold leading-[1.1] tracking-tight tabular-nums [overflow-wrap:anywhere]"
      :class="props.emphasis ? 'text-brand' : props.negative ? 'text-destructive' : 'text-foreground'"
    >{{ props.value }}</span>
    <span v-if="props.caption || $slots.default" class="text-xs text-muted-foreground"><slot>{{ props.caption }}</slot></span>
  </component>
</template>
