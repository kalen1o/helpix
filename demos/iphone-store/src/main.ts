import { createApp } from 'vue'
import App from './App.vue'
import { startAuth } from './auth'
import { router } from './router'
import './styles.css'

if (!import.meta.env.VITE_HELPIX_WIDGET_KEY) {
  console.warn('[orchard] No widget key yet. Run `make seed-demos` with the stack up, then restart this dev server.')
}

createApp(App).use(router).mount('#app')
startAuth()
