import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import type { ErrorCode, ErrorEnvelope, ValidationIssue } from '@baseplate/contracts';
import { getRequestId, type Logger } from '@baseplate/logger';

import { AppError, RateLimitedError } from '../../domain/errors.js';

/**
 * The ONE place an error becomes an HTTP response.
 *
 * Every failure in the application funnels through here, so the envelope shape
 * is guaranteed by construction rather than by everyone remembering it. The
 * mapping from domain error to status code lives here and nowhere else: the
 * service layer throws `NotFoundError`, it does not know what 404 is.
 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error middleware by arity: all four parameters must be
  // declared even though `next` is unused on most paths. Removing it silently
  // turns this into ordinary middleware that never runs.
  return (err, req, res, next) => {
    // If headers are already sent the response is committed; the only correct
    // move is to hand off to Express's default handler, which destroys the
    // socket. Trying to write a second response corrupts the first.
    if (res.headersSent) return next(err);

    const requestId = req.context?.requestId ?? getRequestId();
    const { code, status, publicMessage, details, logLevel, logMessage } = classify(err);

    // The FULL error -- including the stack -- goes to the log, exactly once,
    // correlated by requestId. Nothing is swallowed.
    logger[logLevel](
      {
        err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
        code,
        status,
        method: req.method,
        path: req.path,
      },
      logMessage,
    );

    if (err instanceof RateLimitedError) {
      res.setHeader('retry-after', String(err.retryAfterSeconds));
    }

    const body: ErrorEnvelope = {
      error: {
        code,
        // Public message only. No stack, no SQL, no internal identifier --
        // enforced here because this is the last point before the socket.
        message: publicMessage,
        requestId,
        ...(details && details.length > 0 ? { details } : {}),
      },
    };

    res.status(status).json(body);
  };
}

interface Classified {
  code: ErrorCode;
  status: number;
  publicMessage: string;
  details?: ValidationIssue[];
  logLevel: 'warn' | 'error';
  logMessage: string;
}

function classify(err: unknown): Classified {
  // 1. Our own typed domain errors -- the expected path.
  if (err instanceof AppError) {
    return {
      code: err.code,
      status: STATUS_BY_CODE[err.code],
      publicMessage: err.publicMessage,
      ...(err.details ? { details: err.details } : {}),
      logLevel: err.isClientError ? 'warn' : 'error',
      logMessage: 'request rejected by domain rule',
    };
  }

  // 2. A zod error that escaped the validate() middleware -- e.g. a response
  //    schema assertion. Treated as a client error only because zod is only
  //    ever applied to client input in this codebase.
  if (err instanceof ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      status: 400,
      publicMessage: 'The request was not valid.',
      details: toIssues(err),
      logLevel: 'warn',
      logMessage: 'request failed schema validation',
    };
  }

  // 3. Errors thrown by Express/body-parser before any handler runs. These are
  //    plain Errors with an attached status, so they must be matched
  //    structurally.
  const bodyParserStatus = statusOf(err);
  if (bodyParserStatus === 413) {
    return {
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
      publicMessage: 'The request body is too large.',
      logLevel: 'warn',
      logMessage: 'request body exceeded the configured limit',
    };
  }
  if (bodyParserStatus === 400) {
    return {
      code: 'VALIDATION_FAILED',
      status: 400,
      publicMessage: 'The request body could not be parsed as JSON.',
      logLevel: 'warn',
      logMessage: 'malformed request body',
    };
  }

  // 4. Prisma connectivity failures. These are a DEPENDENCY being down, not a
  //    bug in this service, and the distinction is operationally load-bearing:
  //    503 tells the client to retry and tells the dashboard "database", while
  //    500 tells an on-call engineer to go read our stack traces at 3am.
  if (isConnectivityError(err)) {
    return {
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      publicMessage: 'The service is temporarily unavailable. Please retry.',
      logLevel: 'error',
      logMessage: 'database unreachable',
    };
  }

  // 5. Anything else is a bug in this service until proven otherwise.
  return {
    code: 'INTERNAL',
    status: 500,
    // Fixed string. An unexpected error's message may contain a connection
    // string, a file path, or a row of user data; none of it goes to a client.
    publicMessage: 'An unexpected error occurred.',
    logLevel: 'error',
    logMessage: 'unhandled error',
  };
}

/**
 * Prisma error codes that mean "the database is not reachable/usable right now"
 * as opposed to "your query was wrong".
 *   P1000 authentication failed      P1001 cannot reach the server
 *   P1002 connection timed out       P1008 operation timed out
 *   P1017 server closed the connection
 * Matched structurally rather than with `instanceof` -- see the note on
 * isPrismaErrorWithCode in db/prisma.ts about duplicate copies of the client
 * in a pnpm workspace.
 */
const CONNECTIVITY_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1017']);

function isConnectivityError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;

  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && CONNECTIVITY_CODES.has(code)) return true;

  // A failure to establish the very first connection arrives as an
  // initialization error, which does not always carry a P-code.
  const name = (err as { name?: unknown }).name;
  return name === 'PrismaClientInitializationError';
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = (err as { status?: unknown; statusCode?: unknown });
  const value = candidate.status ?? candidate.statusCode;
  return typeof value === 'number' ? value : undefined;
}

export function toIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    // Reports the client's own field path back to them. Safe by construction:
    // it is derived from the schema, not from server internals.
    path: issue.path.join('.') || '(body)',
    message: issue.message,
  }));
}

/**
 * Terminal 404. Mounted after every route so an unmatched path produces the
 * same envelope as everything else instead of Express's HTML error page --
 * which would break a client that reasonably assumes JSON.
 */
export function notFoundHandler(): RequestHandler {
  return (req, res) => {
    const body: ErrorEnvelope = {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: req.context?.requestId ?? getRequestId(),
      },
    };
    res.status(404).json(body);
  };
}
