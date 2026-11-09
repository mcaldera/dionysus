import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import devTagsPlugin from './devTagsPlugin.ts'

export default defineConfig({
  base: './',
  plugins: [react(), devTagsPlugin()],
  // IPv4 loopback: by default Node resolves "localhost" to ::1 only, and VS Code's port
  // forwarding (which connects via 127.0.0.1) then hangs. Still local-only, not on the network.
  // /api runs on `npm run dev:api`; without it the site just hides the friends' features.
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8787' } },
  preview: { host: '127.0.0.1' },
  // MapLibre 6 loads its worker from a sibling file; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
})
