<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button, HelpixLogo } from '@helpix/ui'
import { session } from '@/auth/session'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()

async function logout() {
  await session.logout()
  await router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="sticky top-0 z-10 border-b bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <div class="flex items-center gap-6">
          <RouterLink to="/" aria-label="helpix home" class="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <HelpixLogo class="h-6" />
          </RouterLink>
          <nav v-if="session.state.me?.admin.role === 'tenant_admin'" aria-label="Main" class="flex items-center gap-1 text-sm">
            <RouterLink
              to="/kb"
              class="rounded-md px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              active-class="bg-secondary text-foreground"
            >
              Knowledge base
            </RouterLink>
          </nav>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span class="hidden text-muted-foreground sm:inline">{{ session.state.me?.admin.email }}</span>
          <ThemeToggle />
          <Button variant="outline" size="sm" @click="logout">Log out</Button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-8">
      <RouterView />
    </main>
  </div>
</template>
