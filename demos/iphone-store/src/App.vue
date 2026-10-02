<script setup lang="ts">
import { computed } from 'vue'
import { auth, signOut } from './auth'
import { bagCount } from './cart'

const firstName = computed(() => auth.customer?.name.split(/\s+/)[0] ?? '')
</script>

<template>
  <div class="flex min-h-dvh flex-col text-ink">
    <!-- N5 floating pill: content-sized, detached from the edges. -->
    <nav
      aria-label="Primary"
      class="fixed left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-pill border border-rule bg-paper/75 p-1.5 shadow-[0_12px_32px_-16px_var(--color-shadow)] backdrop-blur-xl"
    >
      <RouterLink to="/" class="flex items-center gap-2 rounded-pill py-1.5 pl-2 pr-3 font-display text-[0.9375rem] font-semibold tracking-tight">
        <span class="size-4 rounded-full ring-[3px] ring-gold" aria-hidden="true" />
        Orchard
      </RouterLink>
      <RouterLink to="/#lineup" class="whitespace-nowrap rounded-pill px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink">Lineup</RouterLink>
      <RouterLink
        to="/bag"
        class="flex items-center gap-2 whitespace-nowrap rounded-pill bg-paper-3 px-3 py-1.5 text-sm text-ink transition-colors hover:bg-rule"
        :aria-label="`Bag, ${bagCount} ${bagCount === 1 ? 'item' : 'items'}`"
      >
        Bag
        <span class="grid min-w-5 place-items-center rounded-pill px-1 font-mono text-xs tabular-nums" :class="bagCount ? 'bg-gold text-gold-ink' : 'text-ink-3'">{{ bagCount }}</span>
      </RouterLink>
      <RouterLink
        v-if="!auth.customer"
        to="/signin"
        class="whitespace-nowrap rounded-pill px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink"
      >
        Sign in
      </RouterLink>
      <template v-else>
        <span class="max-w-[9ch] truncate pl-2 text-sm text-ink" :title="auth.customer.email">{{ firstName }}</span>
        <button
          type="button"
          class="whitespace-nowrap rounded-pill px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink"
          @click="signOut()"
        >
          Sign out
        </button>
      </template>
    </nav>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 pt-24 sm:px-6">
      <RouterView />
    </main>

    <!-- Ft5 statement footer. Extra bottom padding keeps the meta line clear of the chat launcher. -->
    <footer class="mx-auto mt-[var(--space-3xl)] w-full max-w-6xl px-4 pb-28 sm:px-6">
      <p class="max-w-[22ch] font-display text-[clamp(1.75rem,4vw+0.5rem,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
        Up at 2 a.m. with a question? <span class="text-ink-3">So is the assistant in the corner.</span>
      </p>
      <div class="mt-[var(--space-lg)] flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-4 text-xs text-ink-3">
        <span class="font-display text-sm font-semibold text-ink-2">Orchard</span>
        <span>A fictional shop for the Helpix demo. Nothing here is for sale.</span>
      </div>
    </footer>
  </div>
</template>
