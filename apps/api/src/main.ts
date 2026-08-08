import { createLogger } from '@baseplate/logger';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPrismaClient } from './db/prisma.js';
import { installShutdownHandlers } from './shutdown.js';

/**
 * Process entrypoint. Owns the socket, the signal handlers and the composition
 * root -- and nothing else. All application behaviour lives in `createApp`, so
 * the test suite can build the same app without binding a port.
 */
function main(): void {
  // 1. Configuration. Exits the process on any problem; nothing below this
  //    line has to defend against a missing variable.
  const env = loadEnv();

  const isProduction = env.NODE_ENV === 'production';

  const logger = createLogger({
    name: 'api',
    level: env.LOG_LEVEL,
    // Pretty output for humans in dev; raw NDJSON for log collectors in prod.
    pretty: !isProduction,
    base: { env: env.NODE_ENV, version: env.APP_VERSION },
  });

  /**
   * Fail-fast misconfiguration warning. The most common production-deploy bug
   * is shipping CORS_ORIGINS=http://localhost:8080 (the dev-default from
   * .env.example) to a remote VM. Every browser request from a real origin
   * then gets blocked at the preflight, and the cause is invisible from the
   * browser -- the operator sees a generic "network error" and assumes the
   * API is down.
   *
   * The schema cannot reject this (an operator may legitimately need to
   * bring the service up on localhost first), so warn instead. Triggered
   * only in production, and only when the allowlist LOOKS LIKE the dev
   * default -- empty or containing exactly localhost variants.
   */
  if (isProduction) {
    const origins = env.CORS_ORIGINS;
    const looksLikeDevDefault =
      origins.length === 0 ||
      origins.every((o) => o.startsWith('http://localhost') || o.startsWith('http://127.0.0.1'));
    if (looksLikeDevDefault) {
      logger.warn(
        {
          corsOrigins: origins,
          hint:
            'CORS_ORIGINS only contains localhost origins, but NODE_ENV=production. ' +
            'Every browser request from a real domain will be blocked by CORS. ' +
            'Set CORS_ORIGINS to the real origin (e.g. https://app.example.com) in .env.',
        },
        'CORS_ORIGINS looks like a dev default in production -- browser requests will be blocked',
      );
    }
  }

  const db = createPrismaClient({
    databaseUrl: env.DATABASE_URL,
    logger,
    // Query logs include timings and are noisy; never on in production.
    logQueries: env.LOG_LEVEL === 'trace' && !isProduction,
  });

  /**
   * Readiness gate, owned here because it spans two concerns: the HTTP layer
   * reads it (via /ready) and the shutdown sequence writes it. A module-level
   * boolean in either one would couple them.
   */
  let shuttingDown = false;

  const app = createApp({
    env,
    db,
    logger,
    isShuttingDown: () => shuttingDown,
  });

  const server = app.listen(env.API_PORT, () => {
    // `env` and `version` are already on every line via the logger's `base`;
    // repeating them here would emit a duplicate JSON key.
    logger.info({ port: env.API_PORT, corsOrigins: env.CORS_ORIGINS }, 'api listening');
  });

  /**
   * Longer than any upstream proxy's keep-alive, on purpose.
   *
   * If the server closes an idle keep-alive connection at the exact moment the
   * proxy sends a request on it, the proxy sees a mid-flight reset and returns
   * 502. Making the server's timeout the LONGER of the two guarantees the
   * proxy is always the side that closes. nginx defaults to 60s upstream
   * keepalive; 65s/66s is the conventional margin.
   */
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Note: NO `prisma migrate deploy` here. Migrations are a deliberate,
  // observable deploy step (see docs/runbook.md), not something N replicas
  // race to run at container start.

  installShutdownHandlers({
    server,
    logger,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    markUnhealthy: () => {
      shuttingDown = true;
    },
    onDrained: async () => {
      await db.$disconnect();
    },
  });
}

main();
