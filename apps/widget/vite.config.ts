import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// One self-contained IIFE: shops add a single <script> tag. Vue is bundled; CSS is inlined as a string (?inline)
// and applied inside the shadow root, so no separate stylesheet is emitted.
export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss()],
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
  build: {
    lib: { entry: 'src/main.ts', name: 'HelpixWidget', formats: ['iife'], fileName: () => 'helpix-widget.js' },
    cssCodeSplit: false,
    emptyOutDir: true,
  },
  // Node >= 25 ships a global localStorage that shadows jsdom's; turn it off in the test workers.
  test: { environment: 'jsdom', execArgv: ['--no-experimental-webstorage'] },
}))
