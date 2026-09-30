<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive'
const props = withDefaults(defineProps<{ variant?: Variant; class?: ClassValue }>(), { variant: 'default' })

const VARIANTS: Record<Variant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-destructive text-white',
}
</script>

<template>
  <span :class="cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', VARIANTS[props.variant], props.class)">
    <slot />
  </span>
</template>
