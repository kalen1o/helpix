<script setup lang="ts">
import ProductVisual from '../components/ProductVisual.vue'
import { formatPrice, PRODUCTS, productById } from '../products'

const flagship = productById('orchard-one-pro')!

// Every line here comes from the shop's knowledge base (seed/kb), so the assistant and the page agree.
const PROMISES = [
  { title: 'Free two-day shipping', body: 'On every order in the contiguous US. No minimum, no code.' },
  { title: '30 days to change your mind', body: 'Return anything, for any reason, with a free prepaid label.' },
  { title: 'One-year limited warranty', body: 'Manufacturing defects repaired or replaced at no cost.' },
  { title: 'Orchard Care', body: 'Accidental-damage cover from $9.99 a month. Add it within 60 days.' },
  { title: 'Trade in your old phone', body: 'Get $50 to $650 in credit toward something new.' },
]
</script>

<template>
  <!-- Marquee hero: the statement and the product fill the fold. No button; the first CTA lives in the lineup. -->
  <section class="grid min-h-[calc(100svh-6rem)] items-center gap-10 pb-[var(--space-2xl)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
    <div class="min-w-0">
      <p class="font-mono text-xs uppercase tracking-[0.14em] text-gold">{{ flagship.name }}</p>
      <h1 class="mt-5 text-display font-semibold leading-[0.92] tracking-[-0.045em]">
        Titanium, in its best light.
      </h1>
      <p class="mt-8 max-w-[34ch] text-lg text-ink-2">
        {{ flagship.tagline }} From <span class="tabular-nums text-ink">{{ formatPrice(flagship.storage[0]!.priceCents) }}</span>.
      </p>
      <a href="#lineup" class="mt-8 inline-flex items-center gap-2 text-sm text-ink-2 underline decoration-rule underline-offset-[6px] transition-colors hover:text-ink hover:decoration-ink-3">
        See the lineup <span aria-hidden="true">↓</span>
      </a>
    </div>

    <!-- The flagship, lit on its own stage. -->
    <div class="stage h-[min(36rem,110vw)] min-h-[22rem] md:h-[min(40rem,calc(100svh-10rem))]">
      <ProductVisual :product="flagship" size="lg" decorative eager />
      <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,var(--color-paper-2))]" aria-hidden="true" />
      <p class="absolute bottom-5 left-6 font-mono text-xs uppercase tracking-[0.14em] text-ink-2">48 MP triple camera</p>
    </div>
  </section>

  <!-- Lineup: a diptych per product, the stage swapping sides down the page. -->
  <section id="lineup" class="scroll-mt-24 border-t border-rule pt-[var(--space-2xl)]">
    <h2 class="text-[length:var(--text-display-s)] font-semibold leading-none tracking-[-0.035em]">The lineup.</h2>
    <p class="mt-4 max-w-[46ch] text-ink-2">Three phones and a pair of earbuds. Each one ships free and comes back free if it isn’t right.</p>

    <ul class="mt-[var(--space-xl)] grid gap-[var(--space-xl)]">
      <li
        v-for="(p, i) in PRODUCTS"
        :key="p.id"
        class="grid items-center gap-6 md:grid-cols-2 md:gap-12"
      >
        <RouterLink
          :to="`/product/${p.id}`"
          class="stage group h-[22rem] sm:h-[26rem]"
          :class="i % 2 === 1 && 'md:order-2'"
          :aria-label="`${p.name}, from ${formatPrice(p.storage[0]!.priceCents)}`"
        >
          <div class="absolute inset-0 grid place-items-center transition-transform duration-[var(--dur-med)] ease-out group-hover:scale-[1.03]">
            <ProductVisual :product="p" size="sm" decorative />
          </div>
        </RouterLink>

        <div class="min-w-0 md:px-4">
          <p class="font-mono text-xs tabular-nums text-ink-3">From {{ formatPrice(p.storage[0]!.priceCents) }}</p>
          <h3 class="mt-3 text-[clamp(1.75rem,2.5vw+1rem,2.75rem)] font-semibold leading-none tracking-[-0.03em]">{{ p.name }}</h3>
          <p class="mt-4 text-lg text-ink">{{ p.tagline }}</p>
          <p class="mt-2 max-w-[44ch] text-ink-2">{{ p.description }}</p>
          <div class="mt-6 flex flex-wrap items-center gap-x-5 gap-y-4">
            <ul class="flex items-center gap-2" :aria-label="`Finishes: ${p.colors.map((c) => c.name).join(', ')}`">
              <li v-for="c in p.colors" :key="c.name" class="size-4 rounded-full ring-1 ring-ink/15" :style="{ background: c.body }" :title="c.name" />
            </ul>
            <RouterLink :to="`/product/${p.id}`" class="btn-line">
              Choose {{ p.name.replace('Orchard ', '') }} <span aria-hidden="true">→</span>
            </RouterLink>
          </div>
        </div>
      </li>
    </ul>
  </section>

  <!-- Store promises, set as one elevated panel. -->
  <section class="mt-[var(--space-3xl)] rounded-stage bg-paper-2 p-6 sm:p-10">
    <h2 class="max-w-[20ch] text-[clamp(1.5rem,2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.03em]">
      The fine print, written plainly.
    </h2>
    <dl class="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="item in PROMISES" :key="item.title" class="min-w-0">
        <dt class="font-medium text-ink">{{ item.title }}</dt>
        <dd class="mt-1.5 text-sm text-ink-2">{{ item.body }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="font-medium text-gold">Still unsure?</dt>
        <dd class="mt-1.5 text-sm text-ink-2">Ask the assistant in the corner. It knows every policy above and answers any hour.</dd>
      </div>
    </dl>
  </section>
</template>
