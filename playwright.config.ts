import { defineConfig } from '@playwright/test'

// End-to-end tests run at 1440 × 900 (SPEC 13). "dev" runs the full suite against the dev
// server; "prod" smoke-tests the production build, which is what the host serves (bundling
// problems such as a missing MapLibre worker only show there).
export default defineConfig({
  testDir: 'e2e',
  use: { viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'dev', testIgnore: /prod\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:5173' } },
    { name: 'prod', testMatch: /prod\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4173' } },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
    { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 180_000 },
  ],
})
