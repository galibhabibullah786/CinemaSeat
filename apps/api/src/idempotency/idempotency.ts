import { createHash } from 'node:crypto';

import type { DbClient } from '../db/prisma.js';

/**
 * Generic idempotency support. NOT part of the demo domain -- this file
 * survives `make reset-domain` and is the reference the real domain copies.
 *
 * The contract:
 *   1. A client may send `Idempotency-Key: <opaque string>` on an unsafe request.
 *   2. The first request with that key performs the effect AND records the
 *      response, in ONE transaction.
 *   3. A later request with the same key and the same body gets the recorded
 *      response back, byte for byte, and performs no second effect.
 *   4. The same key with a DIFFERENT body is a client bug -> 409.
 *   5. A concurrent second request loses the unique-constraint race -> 409,
 *      immediately. It never waits.
 */

/** Max header length accepted. Unbounded keys become unbounded index rows. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export interface StoredResponse {
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
}

export interface NewIdempotencyRecord {
  endpoint: string;
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
}

/**
 * The persistence seam. A fake implementation in a unit test needs ~10 lines,
 * which is the whole point of stating it as an interface.
 */
export interface IdempotencyRepository {
  find(db: DbClient, endpoint: string, key: string): Promise<StoredResponse | null>;
  /** Throws a P2002 unique violation if (endpoint, key) already exists. */
  insert(db: DbClient, record: NewIdempotencyRecord): Promise<void>;
}

/**
 * Fingerprint of the request body.
 *
 * Keys are sorted before hashing so `{a:1,b:2}` and `{b:2,a:1}` -- semantically
 * identical JSON that a retrying HTTP client may well reorder -- produce the
 * same hash. Without this, a legitimate retry looks like key reuse and gets a
 * spurious 409.
 */
export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  if (Array.isArray(value)) {
    // Array ORDER is meaningful and is deliberately preserved.
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` disappears in JSON.stringify; drop it here too so the hash
    // matches what actually went over the wire.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Extract and validate the header.
 *
 * Returns undefined when absent -- idempotency is opt-in. Returns undefined
 * for an over-long key as well: rejecting the whole request would break
 * clients that append a harmless suffix, and treating it as absent degrades to
 * ordinary at-most-once-per-attempt behaviour rather than to an error.
 */
export function readIdempotencyKey(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length === 0 || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return undefined;
  }
  return trimmed;
}
