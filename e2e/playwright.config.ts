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
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // single flow; serial keeps failure traces clean.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});