import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import type { Logger } from '@baseplate/logger';

import type { Env } from './config/env.js';
import type { Db } from './db/prisma.js';
import { correlation } from './http/middleware/correlation.js';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler.js';
import { rateLimitWrites } from './http/middleware/rate-limit.js';
import { requestLog } from './http/middleware/request-log.js';
import { healthRoutes } from './http/routes/health.routes.js';
import { PrismaIdempotencyRepository } from './idempotency/prisma-idempotency.repository.js';

// >>> DEMO-DOMAIN:items -- removed by scripts/reset-domain.sh
import { ItemHandler } from './modules/items/item.handler.js';
import { PrismaItemRepository } from './modules/items/item.prisma-repository.js';
import { itemRoutes } from './modules/items/item.routes.js';
import { ItemService } from './modules/items/item.service.js';
// <<< DEMO-DOMAIN:items

export interface CreateAppDeps {
  env: Env;
  db: Db;
  logger: Logger;
  isShuttingDown: () => boolean;
}

/**
 * Builds the Express app WITHOUT starting a listener.
 *
 * That separation is what makes the integration suite possible: supertest
 * drives this object directly, so the tests exercise the real middleware
 * stack -- correlation, validation, the error envelope -- rather than a
 * hand-rolled approximation of it. `main.ts` owns the socket; this file owns
 * the application.
 */
export function createApp(deps: CreateAppDeps): Express {
  const { env, db, logger, isShuttingDown } = deps;
  const app = express();

  // Advertising the framework and version tells a scanner exactly which CVE
  // list to try. Costs nothing to remove.
  app.disable('x-powered-by');

  /**
   * Behind nginx (compose.prod) the immediate peer is always the proxy, so
   * without this every client shares one IP and `req.ip` is useless for rate
   * limiting. `1` = trust exactly one hop. NEVER `true`: trusting an arbitrary
   * chain lets any client forge X-Forwarded-For and pick its own rate-limit
   * bucket.
   */
  app.set('trust proxy', 1);

  // FIRST. Everything downstream -- including the error handler -- depends on
  // a request id existing.
  app.use(correlation());

  // Second, so that even a request rejected by helmet/cors is logged.
  app.use(requestLog(logger));

  /**
   * Security headers. This is an API serving JSON to a separate origin, so the
   * browser-facing policies that matter are the ones that stop content
   * sniffing and framing; CSP is set on the WEB tier (docker/nginx.conf) where
   * there is actually a document to protect.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // HSTS is set by the TLS-terminating proxy, not by the app. Emitting it
      // from a service reachable over plain HTTP inside the compose network is
      // meaningless at best.
      hsts: false,
    }),
  );

  /**
   * Explicit origin allowlist, validated at config load (see config/env.ts).
   *
   * The callback form is used so a disallowed origin gets NO CORS headers --
   * the browser then blocks the read, which is the correct outcome. Throwing
   * would turn it into a 500 and hide the real cause.
   */
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: same-origin, curl, or a server-to-server call.
        // Not a browser cross-origin read, so there is nothing to protect.
        if (!origin) return callback(null, true);
        callback(null, env.CORS_ORIGINS.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'idempotency-key', 'x-request-id', 'traceparent'],
      exposedHeaders: ['x-request-id', 'location', 'retry-after'],
      maxAge: 600,
    }),
  );

  /**
   * Body size limit. Enforced HERE, at the parser, because it is the lowest
   * layer in this process that sees the byte count -- a check in a handler
   * would run only after the whole payload was already buffered in memory.
   * (The truly lowest layer is nginx's client_max_body_size; both are set.)
   */
  app.use(express.json({ limit: env.BODY_LIMIT }));

  // Writes only. Reads are cheap and limiting them breaks the web app's polling.
  app.use(
    rateLimitWrites({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_WRITE_MAX,
    }),
  );

  // --- routes ---------------------------------------------------------------
  app.use(
    healthRoutes({
      db,
      version: env.APP_VERSION,
      startedAt: Date.now(),
      isShuttingDown,
    }),
  );

  // >>> DEMO-DOMAIN:items -- removed by scripts/reset-domain.sh
  const itemService = new ItemService({
    db,
    items: new PrismaItemRepository(),
    idempotency: new PrismaIdempotencyRepository(),
    logger,
  });
  app.use('/items', itemRoutes(new ItemHandler(itemService)));
  // <<< DEMO-DOMAIN:items

  // --- terminal middleware --------------------------------------------------
  // Both must be last, and in this order.
  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
