<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'positive' | 'negative'
const props = withDefaults(defineProps<{ variant?: Variant; dot?: boolean; class?: ClassValue }>(), {
  variant: 'default',
  dot: false,
})

const VARIANTS: Record<Variant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
  // Soft status tints: readable without dominating the row.
  positive: 'border-transparent bg-secondary text-primary',
  negative: 'border-transparent bg-destructive/10 text-destructive',
}
</script>

<template>
  <span
    :class="cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', VARIANTS[props.variant], props.class)"
  >
    <span v-if="props.dot" aria-hidden="true" class="size-1.5 rounded-full bg-current" />
    <slot />
  </span>
</template>
