import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import devTagsPlugin from './devTagsPlugin.ts'

export default defineConfig({
  base: './',
  plugins: [react(), devTagsPlugin()],
  // MapLibre 6 loads its worker from a sibling file; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
