import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { vue: 'vue/dist/vue.esm-bundler.js' } },
  test: { environment: 'jsdom' },
})
