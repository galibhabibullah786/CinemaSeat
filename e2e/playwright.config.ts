import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config. Targets the compose.prod stack by default -- the same
 * topology a user hits in production (web on :8080, nginx proxying /api/ to
 * the API container).
 *
 * `webServer` is NOT used: `make e2e` brings the stack up first and waits
 * for /ready, then runs this suite. Letting Playwright spawn the server
 * would couple it to a stack it does not understand and produce races.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // single flow; serial keeps failure traces clean.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',
  webServer: {
    command: 'pnpm --filter @baseplate/web dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_USE_MOCKS: 'false',
      VITE_API_URL: 'http://localhost:4000',
    },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
