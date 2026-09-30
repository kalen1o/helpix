<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button, HelpixLogo } from '@helpix/ui'
import { session } from '@/auth/session'

const router = useRouter()

async function logout() {
  await session.logout()
  await router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-muted/40">
    <header class="border-b bg-background">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <RouterLink to="/" aria-label="helpix home"><HelpixLogo class="h-6" /></RouterLink>
        <div class="flex items-center gap-3 text-sm">
          <span class="text-muted-foreground">{{ session.state.me?.admin.email }}</span>
          <Button variant="outline" size="sm" @click="logout">Log out</Button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-8">
      <RouterView />
    </main>
  </div>
</template>
