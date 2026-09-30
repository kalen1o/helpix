<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'
import HelpixLogo from './HelpixLogo.vue'

const props = defineProps<{ title: string; description?: string; class?: ClassValue }>()
</script>

<template>
  <div :class="cn('flex flex-col items-center gap-3 px-6 py-12 text-center', props.class)">
    <div class="grid size-12 place-items-center rounded-full bg-secondary">
      <HelpixLogo mark-only class="size-6" />
    </div>
    <div class="grid gap-1">
      <p class="font-medium">{{ props.title }}</p>
      <p v-if="props.description" class="max-w-sm text-sm text-muted-foreground">{{ props.description }}</p>
    </div>
    <div v-if="$slots.default" class="mt-1">
      <slot />
    </div>
  </div>
</template>
