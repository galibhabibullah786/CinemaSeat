import { pino, destination, stdTimeFunctions, type Logger, type LoggerOptions } from 'pino';

import { getContext } from './context.js';

/**
 * Paths pino replaces with `[REDACTED]` before serialising.
 *
 * Why redaction lives in the LOGGER and not at each call site: the lowest layer
 * that can enforce the invariant should enforce it. A rule that depends on
 * every future `log.info({ user })` remembering to strip a field is not a rule,
 * it is a hope. This is the last line of defence -- the first is not putting
 * credentials in an object you log at all.
 *
 * pino's `*` matches exactly ONE level, so both the bare and the one-level
 * forms are listed. Deeply nested secrets are NOT caught -- that is a known
 * limit, documented rather than papered over.
 */
const REDACT_PATHS = [
  // request/response headers (pino-http shapes)
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',

  // common credential-bearing field names, top level and one level deep
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'authorization',
  'sessionId',
  'creditCard',
  'DATABASE_URL',
  '*.password',
  '*.passwd',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.authorization',
  '*.sessionId',
  '*.DATABASE_URL',
];

export interface CreateLoggerOptions {
  /** pino level. Anything below this is not even serialised. */
  level?: string;
  /** Emitted as `service` on every line so one log stream can hold many apps. */
  name: string;
  /** Adds human-readable output. Dev only -- see the note in the body. */
  pretty?: boolean;
  /** Extra static fields (version, region, ...). */
  base?: Record<string, unknown>;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { level = 'info', name, pretty = false, base = {} } = options;

  const config: LoggerOptions = {
    level,
    // `pid`/`hostname` are noise in a container -- the orchestrator already
    // knows both, and they inflate every single line.
    base: { service: name, ...base },
    // ISO timestamps: epoch millis are unreadable when you are grepping a
    // production log at 3am, and every log backend parses ISO-8601.
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      // "level":"info" rather than "level":30. Costs nothing, saves a lookup.
      level: (label) => ({ level: label }),
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    /**
     * Injected into EVERY line, including lines written by libraries that know
     * nothing about our context. This is what makes a log searchable by
     * requestId across the service/repository layers.
     */
    mixin() {
      const ctx = getContext();
      if (!ctx) return {};
      return {
        requestId: ctx.requestId,
        ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
        ...(ctx.parentSpanId ? { parentSpanId: ctx.parentSpanId } : {}),
      };
    },
  };

  /**
   * pino-pretty is a DEV dependency and is loaded via a transport worker.
   * In production we write raw NDJSON to stdout and let the platform collect
   * it -- pretty-printing in production burns CPU to make logs harder to parse.
   */
  if (pretty) {
    return pino({
      ...config,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
      },
    });
  }

  // Explicitly stdout. Never a file: a container that logs to a file has a
  // disk-fill outage waiting to happen and nothing collecting the output.
  return pino(config, destination({ dest: 1, sync: false }));
}

export type { Logger };
