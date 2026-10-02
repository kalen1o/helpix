<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { nextPath, ShopApiError, signUp } from '../auth'

type Field = 'name' | 'email' | 'password'

const route = useRoute()
const router = useRouter()
const form = reactive({ name: '', email: '', password: '' })
const errors = reactive<Record<Field | 'form', string>>({ name: '', email: '', password: '', form: '' })
const busy = ref(false)

// Same rules as the backend, so most mistakes show before a round trip.
function validate(): boolean {
  const name = form.name.trim()
  errors.name = name && name.length <= 80 ? '' : 'Enter your name (up to 80 characters).'
  errors.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? '' : 'Enter a valid email address.'
  errors.password = form.password.length >= 8 ? '' : 'Use at least 8 characters.'
  return !errors.name && !errors.email && !errors.password
}

async function submit() {
  errors.form = ''
  if (!validate()) return
  busy.value = true
  try {
    await signUp(form.name, form.email, form.password)
    await router.push(nextPath(route.query.next))
  } catch (e) {
    if (e instanceof ShopApiError && (e.field === 'name' || e.field === 'email' || e.field === 'password')) errors[e.field] = e.message
    else errors.form = e instanceof ShopApiError ? e.message : 'Something went wrong. Please try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-md py-[var(--space-xl)]">
    <p class="font-mono text-xs uppercase tracking-[0.14em] text-gold">Demo shop</p>
    <h1 class="mt-4 text-[length:var(--text-display-s)] font-semibold leading-none tracking-[-0.035em]">Create an account.</h1>
    <p class="mt-4 text-ink-2">No email check and no payment details: this account only lives in the demo.</p>

    <form class="mt-8 grid gap-5" novalidate @submit.prevent="submit">
      <label class="grid gap-2 text-sm font-medium">
        Name
        <input v-model="form.name" type="text" autocomplete="name" class="field" :aria-invalid="!!errors.name" aria-describedby="signup-name-error" />
        <span id="signup-name-error" class="text-sm font-normal text-alert">{{ errors.name }}</span>
      </label>
      <label class="grid gap-2 text-sm font-medium">
        Email
        <input v-model="form.email" type="email" autocomplete="email" class="field" :aria-invalid="!!errors.email" aria-describedby="signup-email-error" />
        <span id="signup-email-error" class="text-sm font-normal text-alert">{{ errors.email }}</span>
      </label>
      <label class="grid gap-2 text-sm font-medium">
        Password
        <input
          v-model="form.password"
          type="password"
          autocomplete="new-password"
          class="field"
          :aria-invalid="!!errors.password"
          aria-describedby="signup-password-error"
        />
        <span id="signup-password-error" class="text-sm font-normal text-alert">{{ errors.password || '' }}</span>
      </label>
      <p v-if="errors.form" class="text-sm text-alert" role="alert">{{ errors.form }}</p>
      <button type="submit" class="btn-gold w-full" :disabled="busy">{{ busy ? 'Creating your account…' : 'Create account' }}</button>
    </form>

    <p class="mt-6 text-sm text-ink-2">
      Already have one?
      <RouterLink :to="{ path: '/signin', query: route.query }" class="text-ink underline underline-offset-4">Sign in</RouterLink>
    </p>
  </section>
</template>
