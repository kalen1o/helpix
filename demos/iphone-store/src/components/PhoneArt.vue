<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ body: string; accent: string; kind: 'phone' | 'accessory'; cameras?: 2 | 3; size?: 'xs' | 'sm' | 'md' | 'lg' }>(),
  { cameras: 2, size: 'md' },
)

// The art is drawn in em (styles.css `.phone`, `.bud`), so one font-size scales the whole object.
const SCALE = { xs: '0.24rem', sm: '0.8rem', md: '1rem', lg: 'clamp(0.95rem, 1.6vw + 0.3rem, 1.4rem)' }
const style = computed(() => ({ '--art-body': props.body, '--art-accent': props.accent, fontSize: SCALE[props.size] }))
</script>

<template>
  <!-- CSS-only product art: the back of a phone with its camera plateau, or a pair of earbuds. -->
  <div class="relative flex items-end justify-center" :style="style" aria-hidden="true">
    <div v-if="kind === 'phone'" class="phone">
      <div class="phone__plateau">
        <span class="phone__lens phone__lens--a" />
        <span class="phone__lens phone__lens--b" />
        <span v-if="cameras === 3" class="phone__lens phone__lens--c" />
        <span class="phone__flash" />
      </div>
      <span class="phone__mark" />
    </div>
    <div v-else class="flex gap-[1.6em] pb-[5em]">
      <div v-for="i in 2" :key="i" class="bud" :class="i === 2 && 'scale-x-[-1]'">
        <span class="bud__head" /><span class="bud__tip" /><span class="bud__stem" />
      </div>
    </div>
    <span class="art-floor" />
  </div>
</template>
