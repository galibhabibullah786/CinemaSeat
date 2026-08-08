import type { RequestHandler } from 'express';

import type { Logger } from '@baseplate/logger';

/**
 * One structured line per completed request -- the RED metrics (Rate, Errors,
 * Duration) in log form.
 *
 * Written by hand rather than with pino-http for two reasons: it is ~30 lines,
 * and it lets us log the ROUTE PATTERN (`/items/:id`) instead of the concrete
 * URL. That distinction matters enormously: grouping by concrete URL produces
 * unbounded label cardinality and makes "how slow is the item lookup" an
 * unanswerable question.
 */
export function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startNs = process.hrtime.bigint();

    // 'finish' fires when the response is handed to the OS; 'close' catches a
    // client that hung up mid-response. Without 'close' those requests are
    // simply missing from the logs -- and they are exactly the interesting ones.
    let logged = false;
    const done = (aborted: boolean) => {
      if (logged) return;
      logged = true;

      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const status = res.statusCode;

      // Route pattern if Express matched one, else a coarse label. Never the
      // raw URL: `/items/<uuid>` would be a new label for every request.
      const route = (req.route as { path?: string } | undefined)?.path ?? req.baseUrl ?? 'unmatched';

      const payload = {
        method: req.method,
        route,
        status,
        durationMs: Math.round(durationMs * 100) / 100,
        // Length is safe to log; the body is not.
        bytes: Number(res.getHeader('content-length') ?? 0),
        ...(aborted ? { aborted: true } : {}),
      };

      // 5xx is our fault and deserves attention. 4xx is the caller's and is
      // normal traffic -- logging it at error level trains people to ignore
      // errors, which is how the real one gets missed.
      if (status >= 500) logger.error(payload, 'request failed');
      else if (status >= 400) logger.warn(payload, 'request rejected');
      else logger.info(payload, 'request completed');
    };

    res.on('finish', () => done(false));
    res.on('close', () => done(!res.writableEnded));

    next();
  };
}
