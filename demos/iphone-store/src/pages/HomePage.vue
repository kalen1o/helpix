<script setup lang="ts">
import PhoneArt from '../components/PhoneArt.vue'
import { formatPrice, PRODUCTS } from '../products'
</script>

<template>
  <section class="mb-12 max-w-2xl">
    <h1 class="font-display text-5xl font-semibold tracking-tight">The new Orchard lineup.</h1>
    <p class="mt-3 text-lg text-muted-foreground">Free two-day shipping, 30-day returns, and someone to ask in the corner of every page.</p>
  </section>
  <ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
    <li v-for="p in PRODUCTS" :key="p.id">
      <RouterLink :to="`/product/${p.id}`" class="block rounded-xl bg-card p-5 ring-1 ring-border transition hover:ring-foreground/30">
        <PhoneArt :body="p.colors[0]!.body" :accent="p.colors[0]!.accent" :kind="p.kind" />
        <h2 class="mt-4 font-display text-lg font-semibold">{{ p.name }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ p.tagline }}</p>
        <p class="mt-3 text-sm">From {{ formatPrice(p.storage[0]!.priceCents) }}</p>
      </RouterLink>
    </li>
  </ul>
</template>
