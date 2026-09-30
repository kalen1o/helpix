<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, HelpixLogo, Input, Label } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { homeFor } from '@/auth/guard'
import { session } from '@/auth/session'

const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  error.value = null
  busy.value = true
  try {
    const me = await session.login(email.value, password.value)
    await router.push(homeFor(me))
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not reach the server'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted/40 px-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <HelpixLogo class="mb-2 h-8 self-start" />
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Manage your shop's support agent.</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4" @submit.prevent="submit">
          <div class="grid gap-2">
            <Label for="email">Email</Label>
            <Input id="email" v-model="email" type="email" autocomplete="username" required />
          </div>
          <div class="grid gap-2">
            <Label for="password">Password</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
          </div>
          <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
          <Button type="submit" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
