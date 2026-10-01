<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { motion } from 'motion-v'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EASE_OUT, HelpixLogo, Input, Label, shake, SPRING } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { homeFor } from '@/auth/guard'
import { session } from '@/auth/session'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
const form = ref<HTMLFormElement | null>(null)

async function submit() {
  error.value = null
  busy.value = true
  try {
    const me = await session.login(email.value, password.value)
    await router.push(homeFor(me))
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not reach the server'
    // A rejected sign-in shakes the form, like a wrong password on a Mac: the error is felt as well as read.
    await nextTick()
    shake(form.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-4">
    <!-- Faint Mint-wash glow: brand presence without decoration competing with the form. -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,var(--color-secondary),transparent_70%)]"
    />
    <div class="absolute right-4 top-4">
      <ThemeToggle />
    </div>

    <motion.div :initial="{ opacity: 0 }" :animate="{ opacity: 1 }" :transition="{ duration: 0.2, ease: EASE_OUT }" class="relative">
      <HelpixLogo class="h-9" />
    </motion.div>

    <motion.div
      class="relative w-full max-w-sm"
      :initial="{ opacity: 0, y: 8 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ ...SPRING, delay: 0.05 }"
    >
      <Card class="shadow-[0_12px_32px_-12px_rgb(16_26_24/0.18)]">
        <CardHeader>
          <CardTitle class="font-display text-xl tracking-tight">Sign in to helpix</CardTitle>
          <CardDescription>Manage your shop's support agent.</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref="form" class="grid gap-4" @submit.prevent="submit">
            <div class="grid gap-2">
              <Label for="email">Email</Label>
              <Input id="email" v-model="email" type="email" autocomplete="username" placeholder="you@shop.com" required />
            </div>
            <div class="grid gap-2">
              <Label for="password">Password</Label>
              <Input id="password" v-model="password" type="password" autocomplete="current-password" placeholder="Your password" required />
            </div>
            <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
            <Button type="submit" class="mt-1 w-full" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  </div>
</template>
