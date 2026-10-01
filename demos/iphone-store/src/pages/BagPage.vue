<script setup lang="ts">
import { bag, bagTotal, removeFromBag } from '../cart'
import { formatPrice, productById } from '../products'
</script>

<template>
  <h1 class="font-display text-4xl font-semibold tracking-tight">Your bag</h1>
  <p v-if="bag.length === 0" class="mt-6 text-muted-foreground">Your bag is empty. <RouterLink to="/" class="underline">Browse phones</RouterLink></p>
  <template v-else>
    <ul class="mt-8 divide-y divide-border rounded-xl bg-card ring-1 ring-border">
      <li v-for="line in bag" :key="line.key" class="flex items-center gap-4 p-5">
        <div class="flex-1">
          <p class="font-medium">{{ productById(line.productId)?.name ?? line.productId }}</p>
          <p class="text-sm text-muted-foreground">{{ line.color }}<template v-if="line.gb"> · {{ line.gb >= 1024 ? `${line.gb / 1024} TB` : `${line.gb} GB` }}</template> · Qty {{ line.quantity }}</p>
        </div>
        <button type="button" class="text-sm text-muted-foreground underline" @click="removeFromBag(line.key)">Remove</button>
      </li>
    </ul>
    <div class="mt-6 flex items-center justify-between">
      <p class="text-lg">Total {{ formatPrice(bagTotal) }}</p>
      <button type="button" disabled class="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground opacity-50" title="This is a demo shop">
        Check out (demo)
      </button>
    </div>
  </template>
</template>
