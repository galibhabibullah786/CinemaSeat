import { defineConfig } from 'vitest/config';

/**
 * Integration config. Runs against a real Postgres -- the one set up by
 * scripts/with-test-db.sh (which also points DATABASE_URL at it).
 *
 *   INTEGRATION-ONLY: never reuse this for unit tests. The unit suite proves
 *   the service is correct in isolation; the integration suite proves the
 *   repository, the constraints and the transactions all behave at the seam.
 *   Conflating them turns a unit failure into an "is Postgres up?" failure,
 *   which is much harder to read.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    environment: 'node',
    pool: 'forks',
    // Real database, two workers max: the test table is small but the
    // serialisation that makes idempotency correct is lost if two workers
    // trample each other.
    poolOptions: { forks: { singleFork: true } },
    // A full integration run routinely takes 20+ seconds (process spawn,
    // migrations, multi-step scenarios). CI is fine with this; the
    // INNER loop -- the one you run while writing a test -- should be a
    // single file, which is much faster.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
