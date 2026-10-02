<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { addToBag } from '../cart'
import ProductVisual from '../components/ProductVisual.vue'
import { formatCapacity, formatPrice, productById } from '../products'

const props = defineProps<{ id: string }>()
const product = computed(() => productById(props.id))
const color = ref(0)
const storage = ref(0)
const added = ref(false)
watch(() => props.id, () => { color.value = 0; storage.value = 0; added.value = false })
watch([color, storage], () => { added.value = false })

function add() {
  const p = product.value!
  addToBag(p.id, p.colors[color.value]!.name, p.storage[storage.value]!.gb)
  added.value = true
}
</script>

<template>
  <div v-if="!product" class="py-[var(--space-2xl)]">
    <h1 class="text-[length:var(--text-display-s)] font-semibold tracking-[-0.035em]">Nothing here.</h1>
    <p class="mt-4 text-ink-2">That product doesn’t exist.</p>
    <RouterLink to="/#lineup" class="btn-line mt-8">Back to the lineup</RouterLink>
  </div>

  <!-- Split studio: a sticky lit stage on one side, the configurator on the other. -->
  <div v-else class="grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-12">
    <div class="md:sticky md:top-24 md:self-start">
      <div class="stage h-[min(34rem,110vw)] md:h-[calc(100svh-8rem)] md:max-h-[44rem]">
        <ProductVisual :product="product" :color="color" size="lg" eager />
        <div v-if="product.photo" class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_60%,var(--color-paper-2))]" aria-hidden="true" />
        <p class="absolute bottom-5 left-6 font-mono text-xs uppercase tracking-[0.14em] text-ink-2">{{ product.colors[color]!.name }}</p>
      </div>
    </div>

    <div class="min-w-0 md:pt-6">
      <RouterLink to="/#lineup" class="text-sm text-ink-3 transition-colors hover:text-ink"><span aria-hidden="true">←</span> Lineup</RouterLink>
      <h1 class="mt-5 text-[clamp(2.5rem,3.5vw+1rem,4rem)] font-semibold leading-[0.95] tracking-[-0.04em]">{{ product.name }}</h1>
      <p class="mt-4 text-lg text-ink">{{ product.tagline }}</p>
      <p class="mt-2 text-ink-2">{{ product.description }}</p>

      <fieldset class="mt-10">
        <legend class="flex w-full justify-between text-sm">
          <span class="font-medium">Finish</span><span class="text-ink-2">{{ product.colors[color]!.name }}</span>
        </legend>
        <div class="mt-4 flex flex-wrap gap-3">
          <label v-for="(c, i) in product.colors" :key="c.name" class="cursor-pointer">
            <input v-model="color" type="radio" name="finish" :value="i" class="peer sr-only" :aria-label="c.name" />
            <span
              class="block size-10 rounded-full ring-1 ring-ink/15 outline-2 outline-offset-[3px] outline-transparent transition-[outline-color] duration-[var(--dur-short)] peer-checked:outline-ink peer-focus-visible:outline-gold"
              :style="{ background: `linear-gradient(155deg, ${c.accent}, ${c.body} 60%)`, outlineStyle: 'solid' }"
            />
          </label>
        </div>
      </fieldset>

      <fieldset v-if="product.kind === 'phone'" class="mt-8">
        <legend class="text-sm font-medium">Capacity</legend>
        <div class="mt-4 grid gap-2">
          <label v-for="(s, i) in product.storage" :key="s.gb" class="cursor-pointer">
            <input v-model="storage" type="radio" name="capacity" :value="i" class="peer sr-only" />
            <span
              class="flex items-center justify-between rounded-2xl border border-rule px-5 py-4 transition-colors duration-[var(--dur-short)] hover:border-ink-3 peer-checked:border-gold peer-checked:bg-paper-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold"
            >
              <span class="font-medium">{{ formatCapacity(s.gb) }}</span>
              <span class="font-mono text-sm tabular-nums text-ink-2">{{ formatPrice(s.priceCents) }}</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div class="mt-10 rounded-stage bg-paper-2 p-6">
        <div class="flex items-baseline justify-between gap-4">
          <span class="text-sm text-ink-2">{{ product.colors[color]!.name }}<template v-if="product.kind === 'phone'"> · {{ formatCapacity(product.storage[storage]!.gb) }}</template></span>
          <span class="font-display text-2xl font-semibold tabular-nums tracking-tight">{{ formatPrice(product.storage[storage]!.priceCents) }}</span>
        </div>
        <button type="button" class="btn-gold mt-5 w-full" @click="add">Add to bag</button>
        <p class="mt-3 min-h-5 text-center text-sm text-ink-2" role="status">
          <template v-if="added">Added. <RouterLink to="/bag" class="text-ink underline underline-offset-4">Review your bag</RouterLink></template>
        </p>
      </div>

      <ul class="mt-6 grid gap-2 text-sm text-ink-2">
        <li>Free two-day delivery in the contiguous US.</li>
        <li>30-day returns with a prepaid label.</li>
        <li>Questions about Orchard Care or trade-in? Ask the assistant.</li>
      </ul>
    </div>
  </div>
</template>
