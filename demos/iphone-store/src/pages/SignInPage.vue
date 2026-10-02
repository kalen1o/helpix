<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { nextPath, ShopApiError, signIn } from '../auth'

const route = useRoute()
const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = 'Enter your email and password.'
    return
  }
  busy.value = true
  try {
    await signIn(email.value, password.value)
    await router.push(nextPath(route.query.next))
  } catch (e) {
    error.value = e instanceof ShopApiError ? e.message : 'Something went wrong. Please try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-md py-[var(--space-xl)]">
    <p class="font-mono text-xs uppercase tracking-[0.14em] text-gold">Demo shop</p>
    <h1 class="mt-4 text-[length:var(--text-display-s)] font-semibold leading-none tracking-[-0.035em]">Sign in.</h1>
    <p class="mt-4 text-ink-2">
      Try <span class="font-mono text-sm text-ink">maya@orchard.demo</span> with
      <span class="font-mono text-sm text-ink">orchard-demo</span>, or create your own account.
    </p>

    <form class="mt-8 grid gap-5" novalidate @submit.prevent="submit">
      <label class="grid gap-2 text-sm font-medium">
        Email
        <input v-model="email" type="email" autocomplete="email" class="field" :aria-invalid="!!error" aria-describedby="signin-error" />
      </label>
      <label class="grid gap-2 text-sm font-medium">
        Password
        <input v-model="password" type="password" autocomplete="current-password" class="field" :aria-invalid="!!error" aria-describedby="signin-error" />
      </label>
      <p id="signin-error" class="min-h-5 text-sm text-alert" role="alert">{{ error }}</p>
      <button type="submit" class="btn-gold w-full" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
    </form>

    <p class="mt-6 text-sm text-ink-2">
      New here?
      <RouterLink :to="{ path: '/signup', query: route.query }" class="text-ink underline underline-offset-4">Create an account</RouterLink>
    </p>
  </section>
</template>
