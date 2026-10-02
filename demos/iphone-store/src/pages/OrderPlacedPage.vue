<script setup lang="ts">
defineProps<{ orderId: string }>()

const openChat = () => window.Helpix?.open()
</script>

<template>
  <section class="py-[var(--space-xl)]">
    <p class="font-mono text-xs uppercase tracking-[0.14em] text-gold">Demo order · no payment taken</p>
    <h1 class="mt-4 text-[length:var(--text-display-s)] font-semibold leading-none tracking-[-0.035em]">Order #{{ orderId }} placed.</h1>
    <p class="mt-6 max-w-[48ch] text-lg text-ink-2">
      It shows as processing straight away. Ask the assistant in the corner “Where is order {{ orderId }}?” and it checks
      your account.
    </p>
    <div class="mt-8 flex flex-wrap gap-3">
      <button type="button" class="btn-gold" @click="openChat">Ask the assistant</button>
      <RouterLink to="/#lineup" class="btn-line">Keep shopping</RouterLink>
    </div>
  </section>
</template>
