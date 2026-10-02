<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { motion } from 'motion-v'
import { Button, EASE_OUT, HelpixLogo, markPageStart } from '@helpix/ui'
import { session } from '@/auth/session'
import NavLinks from '@/components/NavLinks.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const route = useRoute()

const TENANT_NAV = [
  { to: '/kb', label: 'Knowledge base' },
  { to: '/agent', label: 'Agent' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/conversations', label: 'Conversations' },
]
const SUPER_NAV = [{ to: '/tenants', label: 'Tenants' }]

const me = computed(() => session.state.me)
const nav = computed(() => (me.value?.admin.role === 'super_admin' ? SUPER_NAV : me.value ? TENANT_NAV : []))
const shopName = computed(() => me.value?.tenant?.name ?? null)

const narrowNav = ref<HTMLElement | null>(null)

// Each page opens with a short staggered entrance; later renders (polling, filters) do not animate.
// On narrow screens the nav row scrolls, so bring the current page's link into view.
watch(
  () => route.path,
  async () => {
    markPageStart()
    await nextTick()
    narrowNav.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
  { immediate: true },
)

// Scroll edge: the header's divider appears only once content is underneath it.
const scrolled = ref(false)
const onScroll = () => (scrolled.value = window.scrollY > 4)
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

async function logout() {
  await session.logout()
  await router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="hx-material sticky top-0 z-10" :data-scrolled="scrolled || undefined">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <div class="flex min-w-0 items-center gap-3">
          <RouterLink to="/" aria-label="helpix home" class="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <HelpixLogo class="h-6" />
          </RouterLink>
          <template v-if="shopName">
            <span aria-hidden="true" class="hidden text-border sm:inline">/</span>
            <span class="hidden max-w-48 truncate text-sm font-medium sm:inline" :title="shopName">{{ shopName }}</span>
          </template>
          <nav v-if="nav.length" aria-label="Main" class="ml-3 hidden items-center gap-1 md:flex">
            <NavLinks :items="nav" indicator-id="nav-pill-wide" />
          </nav>
        </div>
        <div class="flex shrink-0 items-center gap-2 text-sm sm:gap-3">
          <span class="hidden max-w-56 truncate text-muted-foreground lg:inline">{{ me?.admin.email }}</span>
          <ThemeToggle />
          <Button variant="outline" size="sm" @click="logout">Log out</Button>
        </div>
      </div>
      <!-- Narrow screens: the nav gets its own row and scrolls sideways instead of overflowing the header. -->
      <nav v-if="nav.length" ref="narrowNav" aria-label="Main" class="hx-scroll-x mx-auto flex max-w-5xl gap-1 px-4 pb-2 md:hidden">
        <NavLinks :items="nav" indicator-id="nav-pill-narrow" />
      </nav>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-8">
      <RouterView v-slot="{ Component, route: current }">
        <!-- Cross-fade between pages; no exit wait, so navigation never blocks input. -->
        <motion.div :key="current.path" :initial="{ opacity: 0 }" :animate="{ opacity: 1 }" :transition="{ duration: 0.2, ease: EASE_OUT }">
          <component :is="Component" />
        </motion.div>
      </RouterView>
    </main>
  </div>
</template>
