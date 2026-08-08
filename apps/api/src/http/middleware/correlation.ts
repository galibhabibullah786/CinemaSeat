import type { RequestHandler } from 'express';

import { contextFromHeaders, runWithContext, type RequestContext } from '@baseplate/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Always set: `correlation` is mounted before every other middleware. */
      context: RequestContext;
    }
  }
}

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Establishes request-scoped correlation. MUST be the first middleware.
 *
 * Calling `next()` inside `runWithContext` puts the entire downstream chain --
 * including every `await` in the service and repository layers -- inside the
 * same AsyncLocalStorage scope. That is what lets a repository log a line with
 * the right requestId without being handed one.
 *
 * The id is echoed back on the response so a user reporting "it failed" can
 * paste one string that finds the exact server-side trace.
 */
export function correlation(): RequestHandler {
  return (req, res, next) => {
    const context = contextFromHeaders({
      traceparent: headerValue(req.headers.traceparent),
      requestId: headerValue(req.headers[REQUEST_ID_HEADER]),
    });

    req.context = context;
    res.setHeader(REQUEST_ID_HEADER, context.requestId);

    runWithContext(context, () => {
      next();
    });
  };
}

/**
 * Node gives a repeated header as string[]. Take the first value rather than
 * joining: a joined value is not a valid traceparent and would be silently
 * discarded further down, which looks like "tracing does not work".
 */
function headerValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
