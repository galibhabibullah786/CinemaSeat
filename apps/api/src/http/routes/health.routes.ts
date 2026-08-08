import { Router } from 'express';

import type { HealthResponse, ReadyResponse } from '@baseplate/contracts';

import { probeDatabase, type Db } from '../../db/prisma.js';
import { asyncRoute } from '../async-route.js';

export interface HealthDeps {
  db: Db;
  version: string;
  /** Process start, captured once at boot rather than read per request. */
  startedAt: number;
  /** Flipped by the shutdown sequence so /ready fails BEFORE the socket closes. */
  isShuttingDown: () => boolean;
}

/**
 * Two endpoints, two different questions. Conflating them is one of the most
 * expensive mistakes in container operations:
 *
 *   /health  (liveness)  "is this process alive?"
 *       Checks nothing external. If it fails, the orchestrator KILLS and
 *       restarts the container. Making it depend on the database means a
 *       30-second database blip restarts every API replica simultaneously --
 *       turning a recoverable dependency outage into a full outage plus a cold
 *       start, exactly when the database is least able to absorb a reconnect
 *       storm.
 *
 *   /ready   (readiness) "can this process serve traffic right now?"
 *       Checks dependencies. If it fails, the load balancer REMOVES the
 *       instance from rotation but leaves it running, so it can rejoin the
 *       moment the dependency recovers -- with its connection pool and caches
 *       still warm.
 */
export function healthRoutes(deps: HealthDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
      version: deps.version,
    };
    // Always 200 while the event loop is turning. That is the entire claim.
    res.status(200).json(body);
  });

  router.get(
    '/ready',
    asyncRoute(async (_req, res) => {
      /**
       * During graceful shutdown we report NOT ready while still serving
       * in-flight requests. This is what makes a zero-downtime deploy work:
       * the load balancer stops sending new traffic a few seconds before the
       * process actually stops accepting connections, so no request is ever
       * sent to a socket that is about to close.
       */
      if (deps.isShuttingDown()) {
        const body: ReadyResponse = {
          status: 'not_ready',
          checks: { database: { ok: false, error: 'shutting_down' } },
        };
        res.status(503).json(body);
        return;
      }

      const database = await probeDatabase(deps.db);

      const body: ReadyResponse = {
        status: database.ok ? 'ready' : 'not_ready',
        checks: {
          database: {
            ok: database.ok,
            latencyMs: Math.round(database.latencyMs * 100) / 100,
            ...(database.error ? { error: database.error } : {}),
          },
        },
      };

      // 503, not 500: this is a dependency problem and it is retryable.
      res.status(database.ok ? 200 : 503).json(body);
    }),
  );

  return router;
}
