<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed } from 'vue'
import { cn } from '../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'destructive-outline' | 'ghost'
type Size = 'default' | 'sm' | 'lg'

const props = withDefaults(
  defineProps<{ variant?: Variant; size?: Size; type?: 'button' | 'submit' | 'reset'; class?: ClassValue }>(),
  { variant: 'default', size: 'default', type: 'button' },
)

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-card hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  'destructive-outline': 'border border-destructive/40 bg-card text-destructive hover:bg-destructive/10',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
}
const SIZES: Record<Size, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-6',
}

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
    // Press feedback: a subtle scale so the button visibly responds.
    'transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97]',
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
