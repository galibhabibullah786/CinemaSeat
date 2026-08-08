import { z } from 'zod';

/**
 * Environment validation.
 *
 * INVARIANT: the process either has a complete, well-typed configuration or it
 * does not start. Enforced HERE -- at the boundary between the operating system
 * and the program -- because it is the lowest layer that can see the raw
 * strings. Pushing it lower (into each consumer) means a missing variable
 * surfaces as `undefined` three layers deep at 2am under load; pushing it
 * higher means a route handler has to defend against it.
 *
 * Every variable read anywhere in the API appears in this schema and in
 * .env.example. There is no `process.env` access outside this file.
 */
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  // Not `.url()`: postgres:// is a valid URL but zod's url() also accepts
  // http://, which would fail much later inside Prisma with a worse message.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL must be a postgresql:// connection string',
    ),

  /**
   * Explicit allowlist. `*` is rejected rather than merely discouraged: with
   * credentials enabled a wildcard origin is a cross-site read of every
   * authenticated response, and "we will fix it before launch" never happens.
   */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    )
    .refine((list) => !list.includes('*'), 'CORS_ORIGINS must not contain "*" -- list exact origins'),

  /** Passed straight to express.json({ limit }). Accepts "100kb", "1mb", ... */
  BODY_LIMIT: z.string().default('100kb'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(60),

  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  /** Surfaced by /health so you can tell which build is actually running. */
  APP_VERSION: z.string().default('dev'),
});

export type Env = z.output<typeof EnvSchema>;

/**
 * Parse and freeze. Called once at startup.
 *
 * On failure this prints every problem at once -- not just the first -- and
 * exits non-zero. A container that starts with bad config and then 500s is
 * strictly worse than one that refuses to start: the orchestrator can see a
 * crash loop, but it cannot see "quietly wrong".
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // console.error, not the logger: the logger is configured FROM this config,
    // so it does not exist yet. This is the one legitimate use in the app.
    console.error(`\nInvalid environment configuration:\n${problems}\n`);
    console.error('See .env.example for the full list of variables.\n');
    process.exit(1);
  }

  return Object.freeze(parsed.data);
}
