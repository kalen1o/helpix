<script setup lang="ts">
import { computed } from 'vue'
import type { Product } from '../products'
import PhoneArt from './PhoneArt.vue'

// Fills its (relative, overflow-hidden) parent: the stock photo when the product has one, otherwise the CSS art.
const props = withDefaults(
  defineProps<{ product: Product; color?: number; size?: 'xs' | 'sm' | 'md' | 'lg'; decorative?: boolean; eager?: boolean }>(),
  { color: 0, size: 'md', decorative: false, eager: false },
)
const finish = computed(() => props.product.colors[props.color] ?? props.product.colors[0]!)
</script>

<template>
  <img
    v-if="product.photo"
    :src="product.photo.src"
    :alt="decorative ? '' : product.photo.alt"
    :loading="eager ? 'eager' : 'lazy'"
    class="absolute inset-0 size-full object-cover"
    :style="{ objectPosition: product.photo.focus }"
  />
  <PhoneArt v-else :size="size" :body="finish.body" :accent="finish.accent" :kind="product.kind" :cameras="product.cameras" />
</template>
