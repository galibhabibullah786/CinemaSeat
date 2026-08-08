// Generated client, not the '@prisma/client' package entry point. See the long
// note on `output` in prisma/schema.prisma for why this is a relative path.
import { PrismaClient, type Prisma } from '../../generated/prisma/index.js';

import type { Logger } from '@baseplate/logger';

/**
 * The Prisma client, and the transaction-scoped variant handed to repositories
 * inside `$transaction`. Repositories accept `DbClient` so the SAME repository
 * code runs both standalone and inside a transaction -- without that, every
 * method needs a duplicate "...InTransaction" twin.
 */
export type Db = PrismaClient;
export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CreatePrismaOptions {
  databaseUrl: string;
  logger: Logger;
  /** Emit every SQL statement. Dev only -- query logs contain parameter values. */
  logQueries?: boolean;
}

export function createPrismaClient(options: CreatePrismaOptions): PrismaClient {
  const { databaseUrl, logger, logQueries = false } = options;

  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    // Emit as events rather than letting Prisma write to stdout directly:
    // Prisma's own output is not JSON and would corrupt a structured log stream.
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
      ...(logQueries ? ([{ level: 'query', emit: 'event' }] as const) : []),
    ],
  });

  client.$on('warn' as never, (e: Prisma.LogEvent) => {
    logger.warn({ prisma: e.message }, 'prisma warning');
  });

  client.$on('error' as never, (e: Prisma.LogEvent) => {
    logger.error({ prisma: e.message }, 'prisma error');
  });

  if (logQueries) {
    client.$on('query' as never, (e: Prisma.QueryEvent) => {
      // `params` deliberately omitted: it contains raw user input and would
      // defeat the logger's redaction, which cannot see inside a SQL string.
      logger.debug({ query: e.query, durationMs: e.duration }, 'prisma query');
    });
  }

  return client;
}

/** Postgres/Prisma unique-constraint violation. */
export const UNIQUE_VIOLATION = 'P2002';

/**
 * Narrow an unknown throw to a Prisma error with a code.
 *
 * `instanceof PrismaClientKnownRequestError` is unreliable across a pnpm
 * workspace, where the app and a dependency can each resolve their own copy of
 * @prisma/client and the prototype chains differ. Structural checking is ugly
 * and correct; identity checking is elegant and occasionally wrong.
 */
export function isPrismaErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export interface DatabaseProbe {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Liveness probe for the database, used by GET /ready.
 *
 * `SELECT 1` and nothing more: the probe must be cheaper than the cheapest real
 * request, or readiness checks become the load that makes the service unready.
 *
 * The timeout is the important part. Without it a probe against a hung TCP
 * connection inherits the OS-level timeout (minutes), so /ready hangs instead
 * of reporting 503, and the load balancer keeps routing traffic to a dead
 * instance the whole time.
 */
export async function probeDatabase(db: Db, timeoutMs = 2_000): Promise<DatabaseProbe> {
  const start = process.hrtime.bigint();

  const timeout = new Promise<never>((_resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`database probe timed out after ${timeoutMs}ms`)), timeoutMs);
    // Do not hold the event loop open just for the probe's timer.
    t.unref?.();
  });

  try {
    await Promise.race([db.$queryRaw`SELECT 1`, timeout]);
    return { ok: true, latencyMs: elapsedMs(start) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: elapsedMs(start),
      // A short, safe label. The driver message names host, port and user --
      // all of which would then be served to an unauthenticated caller.
      error: error instanceof Error && error.message.includes('timed out')
        ? 'timeout'
        : 'unreachable',
    };
  }
}

function elapsedMs(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}
