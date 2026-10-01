<script setup lang="ts">
import { useRoute } from 'vue-router'
import { motion } from 'motion-v'
import { SPRING_MOVE } from '@helpix/ui'

defineProps<{ items: { to: string; label: string }[]; indicatorId: string }>()

const route = useRoute()
const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
</script>

<template>
  <!-- The Mint-wash pill slides to the active item, so a route change reads as moving, not blinking. -->
  <RouterLink
    v-for="item in items"
    :key="item.to"
    :to="item.to"
    :aria-current="isActive(item.to) ? 'page' : undefined"
    class="relative shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-[color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :class="isActive(item.to) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
  >
    <motion.span
      v-if="isActive(item.to)"
      :layout-id="indicatorId"
      :transition="SPRING_MOVE"
      aria-hidden="true"
      class="absolute inset-0 rounded-md bg-secondary"
    />
    <span class="relative">{{ item.label }}</span>
  </RouterLink>
</template>
