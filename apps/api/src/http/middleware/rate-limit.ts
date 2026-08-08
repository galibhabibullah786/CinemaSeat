import type { RequestHandler } from 'express';

import { RateLimitedError } from '../../domain/errors.js';

/**
 * A deliberately small in-memory rate limiter for WRITE methods.
 *
 * ============================ READ THIS BEFORE SCALING =====================
 * This counter lives in ONE process's heap. With N replicas behind a load
 * balancer the effective limit is N x RATE_LIMIT_WRITE_MAX, and a client that
 * reconnects to a different replica gets a fresh budget. It is also lost on
 * every restart and every deploy.
 *
 * That is acceptable for a single-container deployment, which is what this
 * baseplate targets, and it is NOT acceptable the moment there is a second
 * replica. The fix is a shared counter in Redis (INCR + EXPIRE, or a token
 * bucket in a Lua script so the check and the decrement are atomic). Swapping
 * the store is the only change needed -- the middleware shape stays.
 *
 * It is also not a defence against a distributed attacker: per-IP counting
 * falls to a botnet, and X-Forwarded-For is attacker-controlled unless a trusted
 * proxy overwrites it (see `trust proxy` in app.ts). Real abuse protection
 * belongs at the edge. This exists to stop one buggy client's retry loop from
 * saturating the database.
 * ===========================================================================
 */

interface Bucket {
  count: number;
  /** Epoch ms at which this window expires. */
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Methods that consume budget. Reads are intentionally not limited here. */
  methods?: readonly string[];
  /** Hard cap on tracked keys -- see the eviction note below. */
  maxKeys?: number;
}

export function rateLimitWrites(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, methods = ['POST', 'PUT', 'PATCH', 'DELETE'], maxKeys = 10_000 } = options;

  const buckets = new Map<string, Bucket>();

  /**
   * Sweep expired buckets. Without this the Map is an unbounded memory leak
   * keyed by attacker-controlled input -- the limiter becomes the outage.
   * `unref` so this timer never keeps the process alive during shutdown.
   */
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  sweeper.unref();

  return (req, _res, next) => {
    if (!methods.includes(req.method)) return next();

    const now = Date.now();
    const key = clientKey(req.ip);

    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      // Second line of defence on memory: if we are somehow at the cap with
      // live windows, fail OPEN rather than start rejecting real users. A rate
      // limiter that turns into a global outage is worse than no limiter.
      if (buckets.size >= maxKeys) return next();

      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;

    if (existing.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      // Thrown, not written directly, so it goes through the one error
      // middleware and gets the same envelope and requestId as everything else.
      return next(new RateLimitedError(retryAfterSeconds));
    }

    return next();
  };
}

/**
 * `req.ip` respects Express's `trust proxy` setting. When that is configured
 * correctly it is the real client IP; when it is not, it is the proxy's IP and
 * every user shares one bucket. Falling back to a constant is deliberate: one
 * shared bucket still bounds total write load, whereas keying on `undefined`
 * would silently disable the limiter.
 */
function clientKey(ip: string | undefined): string {
  return ip && ip.length > 0 ? ip : 'unknown';
}
