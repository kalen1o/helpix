<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
    <div class="grid min-w-0 gap-1">
      <slot name="eyebrow" />
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 class="min-w-0 text-2xl font-semibold [overflow-wrap:anywhere]">{{ title }}</h1>
        <slot name="badge" />
      </div>
      <p v-if="description || $slots.description" class="text-sm text-muted-foreground">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
