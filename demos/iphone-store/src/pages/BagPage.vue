<script setup lang="ts">
import ProductVisual from '../components/ProductVisual.vue'
import { bag, bagCount, bagTotal, removeFromBag } from '../cart'
import { formatCapacity, formatPrice, productById } from '../products'

const linePrice = (productId: string, gb: number) => productById(productId)?.storage.find((s) => s.gb === gb)?.priceCents ?? 0
</script>

<template>
  <h1 class="text-[length:var(--text-display-s)] font-semibold leading-none tracking-[-0.035em]">Your bag.</h1>

  <div v-if="bag.length === 0" class="mt-8">
    <p class="text-lg text-ink-2">Nothing in it yet.</p>
    <RouterLink to="/#lineup" class="btn-line mt-6">See the lineup <span aria-hidden="true">→</span></RouterLink>
  </div>

  <div v-else class="mt-10 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:items-start">
    <ul class="grid gap-3">
      <li v-for="line in bag" :key="line.key" class="flex items-center gap-4 rounded-stage bg-paper-2 p-4 sm:gap-6 sm:p-5">
        <div class="stage h-24 w-20 flex-none rounded-2xl bg-paper-3">
          <ProductVisual
            v-if="productById(line.productId)"
            :product="productById(line.productId)!"
            :color="Math.max(0, productById(line.productId)!.colors.findIndex((c) => c.name === line.color))"
            size="xs"
            decorative
          />
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-medium">{{ productById(line.productId)?.name ?? line.productId }}</p>
          <p class="mt-1 text-sm text-ink-2">
            {{ line.color }}<template v-if="line.gb"> · {{ formatCapacity(line.gb) }}</template> · Qty {{ line.quantity }}
          </p>
          <button type="button" class="mt-2 text-sm text-ink-3 underline underline-offset-4 transition-colors hover:text-ink" @click="removeFromBag(line.key)">
            Remove
          </button>
        </div>
        <p class="self-start font-mono text-sm tabular-nums">{{ formatPrice(linePrice(line.productId, line.gb) * line.quantity) }}</p>
      </li>
    </ul>

    <aside class="rounded-stage border border-rule p-6 lg:sticky lg:top-24">
      <dl class="grid gap-3 text-sm">
        <div class="flex justify-between"><dt class="text-ink-2">Items</dt><dd class="font-mono tabular-nums">{{ bagCount }}</dd></div>
        <div class="flex justify-between"><dt class="text-ink-2">Shipping</dt><dd>Free, two days</dd></div>
        <div class="flex items-baseline justify-between border-t border-rule pt-4">
          <dt class="font-medium">Total</dt>
          <dd class="font-display text-2xl font-semibold tabular-nums tracking-tight">{{ formatPrice(bagTotal) }}</dd>
        </div>
      </dl>
      <button type="button" disabled class="btn-gold mt-6 w-full" aria-describedby="checkout-note">Check out</button>
      <p id="checkout-note" class="mt-3 text-center text-xs text-ink-3">Checkout is switched off in this demo shop.</p>
    </aside>
  </div>
</template>
