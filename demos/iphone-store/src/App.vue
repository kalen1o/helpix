<script setup lang="ts">
import { bagCount } from './cart'
</script>

<template>
  <div class="min-h-dvh bg-background text-foreground">
    <header class="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <nav class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <RouterLink to="/" class="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
          <span class="grid size-6 place-items-center rounded-full bg-foreground text-[11px] font-bold text-background" aria-hidden="true">O</span>
          Orchard
        </RouterLink>
        <RouterLink to="/" class="text-sm text-muted-foreground hover:text-foreground">Phones</RouterLink>
        <span class="flex-1" />
        <RouterLink to="/bag" class="text-sm text-muted-foreground hover:text-foreground">Bag ({{ bagCount }})</RouterLink>
      </nav>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-10">
      <RouterView />
    </main>
    <footer class="mx-auto max-w-6xl px-4 pb-24 text-xs text-muted-foreground">
      Orchard Store is a fictional shop for the Helpix demo. Nothing here is for sale.
    </footer>
  </div>
</template>
