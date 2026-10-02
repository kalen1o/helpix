import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// The tenant's allowed origin is exactly http://localhost:5174 (seed/shop.json), so never drift to another port.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // The demo backend (server/main.ts) answers /api on :4101; proxying keeps its session cookie same-origin.
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://localhost:4101' } },
  // Node >= 25 ships a global localStorage that shadows jsdom's; turn it off in the test workers.
  test: { environment: 'jsdom', execArgv: ['--no-experimental-webstorage'] },
})
