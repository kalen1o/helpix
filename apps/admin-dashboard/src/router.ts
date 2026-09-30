import { createRouter, createWebHistory } from 'vue-router'
import type { MeResponse, Role } from '@helpix/shared/api-types'
import { guard } from '@/auth/guard'
import { session, tokenStore } from '@/auth/session'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    role?: Role
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/pages/LoginPage.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/login' },
        { path: 'tenants', component: () => import('@/pages/TenantsPage.vue'), meta: { role: 'super_admin' } },
        { path: 'home', component: () => import('@/pages/TenantHomePage.vue'), meta: { role: 'tenant_admin' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/login' },
  ],
})

router.beforeEach(async (to) => {
  if (tokenStore.get() && !session.state.me) {
    try {
      await session.loadMe()
    } catch {
      tokenStore.set(null)
    }
  }
  return guard({ public: to.meta.public, role: to.meta.role }, session.state.me as MeResponse | null, tokenStore.get() !== null)
})
