import { defineConfig } from '@playwright/test'

// End-to-end tests run at 1440 × 900 (SPEC 13). "dev" runs the full suite against the dev
// server; "prod" runs the production build on the real Worker with a local D1 database, which
// is what the host serves (bundling problems such as a missing MapLibre worker only show there).
export default defineConfig({
  testDir: 'e2e',
  use: { viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'dev', testIgnore: /prod\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:5173' } },
    { name: 'prod', testMatch: /prod\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4173' } },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
    {
      command: 'rm -rf .wrangler/e2e && npm run build && npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e && npx wrangler dev --port 4173 --ip 127.0.0.1 --persist-to .wrangler/e2e --var INVITE_CODE:e2e-einladungscode',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
})
