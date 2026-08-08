import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Adapts an async handler to Express 4's synchronous error convention.
 *
 * Express 4 does not await handlers. A rejected promise from a bare `async`
 * route is an UNHANDLED REJECTION: the client's connection hangs until it times
 * out, the error middleware never runs, and (since Node 15) the process may be
 * killed outright. Express 5 fixes this natively -- until then, every async
 * route must be wrapped.
 *
 * This is the reason the ESLint rule `@typescript-eslint/no-floating-promises`
 * is an error in this repo: it is the automated half of the same guard.
 */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
