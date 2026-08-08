import type { Server } from 'node:http';

import type { Logger } from '@baseplate/logger';

export interface ShutdownOptions {
  server: Server;
  logger: Logger;
  /** Hard cap. After this the process exits non-zero rather than hanging. */
  timeoutMs: number;
  /** Release pools, flush buffers. Must be idempotent and must not throw. */
  onDrained: () => Promise<void>;
  /** Called first, to make /ready report 503 before the socket closes. */
  markUnhealthy: () => void;
}

/**
 * Graceful shutdown.
 *
 * ============================ THE PID 1 PROBLEM ============================
 * In a container the entrypoint process is PID 1, and PID 1 is special: the
 * kernel does NOT install default signal handlers for it. A signal with no
 * explicit handler is simply DISCARDED. Two consequences:
 *
 *   1. If `node` is PID 1 and does not handle SIGTERM, `docker stop` appears to
 *      do nothing for 10 seconds and then SIGKILLs the process -- in-flight
 *      requests are severed and every deploy has a 10s tail. This file is the
 *      handler that prevents that.
 *
 *   2. If the entrypoint is a SHELL (`ENTRYPOINT sh -c "node dist/main.js"`,
 *      or the shell form of CMD), the shell is PID 1 and it does not forward
 *      signals to its child. Node never receives SIGTERM at all, and no amount
 *      of handling here helps. That is why every Dockerfile in this repo uses
 *      the EXEC form (`ENTRYPOINT ["node", "dist/main.js"]`) and why compose
 *      sets `init: true` -- which puts tini at PID 1 to forward signals and to
 *      reap zombies, a job PID 1 is also uniquely responsible for.
 *
 * Verify with: `time docker stop <container>` -- it must return in well under
 * the 10s SIGKILL timeout.
 * ===========================================================================
 */
export function installShutdownHandlers(options: ShutdownOptions): void {
  const { server, logger, timeoutMs, onDrained, markUnhealthy } = options;

  // Guards against a second SIGTERM (or a SIGINT after a SIGTERM) restarting
  // the sequence and double-closing the pool.
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn({ signal }, 'shutdown already in progress; ignoring signal');
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, 'shutdown initiated');

    // 1. Fail readiness FIRST. The load balancer stops routing new requests
    //    while we are still able to finish the ones already in flight.
    markUnhealthy();

    /**
     * 2. The hard cap. `unref()` so this timer is not itself a reason the
     *    process stays alive -- if everything drains early we exit at once
     *    instead of waiting out the full timeout.
     *
     *    Exit code 1, not 0: a shutdown that had to be forced lost in-flight
     *    work, and that should be visible in the orchestrator's event log
     *    rather than indistinguishable from a clean stop.
     */
    const hardExit = setTimeout(() => {
      logger.error({ timeoutMs }, 'graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, timeoutMs);
    hardExit.unref();

    // 3. Stop accepting NEW connections. The callback fires once every
    //    existing connection has finished. Note that `close` alone is not
    //    enough: an idle HTTP keep-alive connection holds the server open
    //    until the client happens to disconnect, which can be minutes.
    server.close((closeError) => {
      if (closeError) {
        logger.error({ err: closeError }, 'error while closing the http server');
      }

      /**
       * 4. Release downstream resources -- only after the last response is
       *    out, since closing the database pool first would fail the very
       *    requests we are trying to protect.
       *
       *    Two hard-won details here, both found by testing SIGTERM against a
       *    frozen database rather than a healthy one:
       *
       *    (a) Cleanup is BOUNDED. `prisma.$disconnect()` will sit there
       *        retrying against an unreachable server; unbounded, it eats the
       *        entire shutdown budget and we get SIGKILLed instead of exiting.
       *
       *    (b) Cleanup failure does NOT change the exit code. By this point
       *        every in-flight request has been answered -- the contract with
       *        clients is already honoured. Failing to close a pool whose
       *        server has already gone away is not a data-loss event (Prisma
       *        holds no client-side write buffer), and reporting exit 1 would
       *        tell the orchestrator a clean drain was a failed one.
       *        If you add cleanup that CAN lose data -- flushing a batch, a
       *        queue ack -- revisit this decision for that resource.
       */
      const cleanupBudgetMs = Math.min(2_000, Math.floor(timeoutMs / 2));

      void withTimeout(onDrained(), cleanupBudgetMs)
        .then((outcome) => {
          if (outcome.timedOut) {
            logger.warn({ cleanupBudgetMs }, 'resource cleanup timed out; exiting anyway');
          } else if (outcome.error) {
            logger.warn({ err: outcome.error }, 'resource cleanup failed; exiting anyway');
          }
          logger.info('shutdown complete');
          process.exit(0);
        });
    });

    // Available since Node 18.2. Closes connections sitting idle right now, so
    // a keep-alive client that is not mid-request does not hold us open.
    server.closeIdleConnections();
  };

  // SIGTERM: orchestrator/`docker stop`. SIGINT: Ctrl-C in dev.
  // Both get the same treatment so dev behaviour matches production.
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  /**
   * An uncaught exception leaves the process in an UNKNOWN state -- a half-run
   * handler may have written one row of two. Log it and exit; the orchestrator
   * restarts a clean process. Attempting to continue is how corrupt data gets
   * written.
   */
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception; exiting');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection; exiting');
    process.exit(1);
  });
}

interface TimedOutcome {
  timedOut: boolean;
  error?: unknown;
}

/**
 * Await `work`, but give up after `ms`.
 *
 * Never rejects -- the caller gets an outcome to inspect instead. A helper used
 * on the shutdown path must not be able to throw, or it becomes the reason the
 * process fails to shut down.
 */
function withTimeout(work: Promise<unknown>, ms: number): Promise<TimedOutcome> {
  return new Promise<TimedOutcome>((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    timer.unref();

    work.then(
      () => {
        clearTimeout(timer);
        resolve({ timedOut: false });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ timedOut: false, error });
      },
    );
  });
}
