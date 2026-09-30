<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed } from 'vue'
import { cn } from '../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost'
type Size = 'default' | 'sm' | 'lg'

const props = withDefaults(
  defineProps<{ variant?: Variant; size?: Size; type?: 'button' | 'submit' | 'reset'; class?: ClassValue }>(),
  { variant: 'default', size: 'default', type: 'button' },
)

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
}
const SIZES: Record<Size, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-6',
}

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[props.variant],
    SIZES[props.size],
    props.class,
  ),
)
</script>

<template>
  <button :type="type" :class="classes"><slot /></button>
</template>
