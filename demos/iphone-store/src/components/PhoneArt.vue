<script setup lang="ts">
defineProps<{ body: string; accent: string; kind: 'phone' | 'accessory'; size?: 'sm' | 'lg' }>()
</script>

<template>
  <!-- CSS-only product art: a rounded slab with a camera island, or a pair of earbuds. -->
  <div class="grid place-items-center" :class="size === 'lg' ? 'h-96' : 'h-56'" aria-hidden="true">
    <div
      v-if="kind === 'phone'"
      class="relative rounded-[2.2rem] shadow-2xl ring-1 ring-white/10"
      :class="size === 'lg' ? 'h-80 w-40' : 'h-44 w-22'"
      :style="{ background: `linear-gradient(160deg, ${accent}, ${body} 55%)` }"
    >
      <div class="absolute left-3 top-3 grid size-[38%] grid-cols-2 gap-1 rounded-2xl bg-black/25 p-1.5">
        <span v-for="i in 3" :key="i" class="rounded-full bg-black/70 ring-2 ring-white/10" />
      </div>
    </div>
    <div v-else class="flex gap-3">
      <span v-for="i in 2" :key="i" class="block h-20 w-10 rounded-full shadow-xl ring-1 ring-black/10" :style="{ background: `linear-gradient(180deg, ${accent}, ${body})` }" />
    </div>
  </div>
</template>
