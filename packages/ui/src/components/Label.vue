<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

const props = defineProps<{ class?: ClassValue }>()
</script>

<template>
  <label :class="cn('text-sm font-medium leading-none', props.class)"><slot /></label>
</template>
