import { createRouter, createWebHistory } from 'vue-router'
import BagPage from './pages/BagPage.vue'
import HomePage from './pages/HomePage.vue'
import ProductPage from './pages/ProductPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage },
    { path: '/product/:id', component: ProductPage, props: true },
    { path: '/bag', component: BagPage },
  ],
  // `/#lineup` lands on the section (it carries scroll-margin for the floating nav); every other route starts at the top.
  scrollBehavior: (to) => (to.hash ? { el: to.hash } : { top: 0 }),
})
