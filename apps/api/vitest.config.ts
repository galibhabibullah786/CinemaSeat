import { defineConfig } from 'vitest/config';

/**
 * Default Vitest config. Runs UNIT tests (no DB).
 *
 *   pnpm --filter @baseplate/api test            -> everything (this one)
 *   pnpm --filter @baseplate/api test:unit       -> this one, scoped
 *   pnpm --filter @baseplate/api test:integration -> vitest.integration.config.ts
 *
 * The two configs are split so the unit suite stays fast and dependency-free
 * (no Prisma client, no pool, no container), and the integration suite can
 * require a real Postgres without making the inner loop pay for it.
 */
export default defineConfig({
  test: {
    // src/modules/items, src/idempotency, src/http, src/domain -- the service
    // and its surrounding contracts. Anything that touches a database goes
    // through the integration config instead.
    include: [
      'src/**/*.unit.test.ts',
      'src/**/*.test.ts',
    ],
    exclude: [
      'src/**/*.integration.test.ts',
      'node_modules/**',
      'dist/**',
    ],
    environment: 'node',
    pool: 'forks',
    // One worker per CPU by default; the unit suite is small and serial.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/modules/**', 'src/idempotency/**', 'src/domain/**'],
      // Service-layer exercise: do not weigh the score with the HTTP plumbing.
    },
  },
});
