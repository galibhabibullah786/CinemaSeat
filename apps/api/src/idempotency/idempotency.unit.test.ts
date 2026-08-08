import { describe, expect, it } from 'vitest';

import { hashRequestBody, readIdempotencyKey } from './idempotency.js';

/**
 * Contract tests for the idempotency helpers.
 *
 * These functions are the ONLY thing that stands between a body and its
 * fingerprint, and a typo here turned into "valid retries get 409" is a
 * debugging session nobody wants.
 */
describe('hashRequestBody', () => {
  it('produces the same hash for two objects with the same keys in different orders', () => {
    // Property order is a network concern, not a semantic one. A retry must
    // hit the cache, not the 409 branch.
    expect(hashRequestBody({ a: 1, b: 2 })).toBe(hashRequestBody({ b: 2, a: 1 }));
  });

  it('produces a different hash for arrays whose order changed', () => {
    // Array order IS semantic -- [a,b] is not [b,a]. Verifies we do not
    // over-canonicalise.
    expect(hashRequestBody([1, 2])).not.toBe(hashRequestBody([2, 1]));
  });

  it('drops undefined so a payload with and without optional fields matches', () => {
    // JSON.stringify drops undefined; reading the body back through Express
    // gives the same payload in both cases. The hash must match.
    const a = { name: 'A', quantity: 1, note: undefined };
    const b = { name: 'A', quantity: 1 };
    expect(hashRequestBody(a)).toBe(hashRequestBody(b));
  });

  it('nulls are preserved as null (not silently coerced to undefined)', () => {
    // `null` is a real value and must round-trip. A canonicaliser that drops
    // it would let a client confuse "explicit null" with "no value".
    expect(hashRequestBody({ x: null })).toBe(hashRequestBody({ x: null }));
    expect(hashRequestBody({ x: null })).not.toBe(hashRequestBody({}));
  });

  it('hashes nested objects recursively', () => {
    const a = { x: { y: 1, z: 2 } };
    const b = { x: { z: 2, y: 1 } };
    expect(hashRequestBody(a)).toBe(hashRequestBody(b));
  });

  it('returns a 64-character hex string (SHA-256)', () => {
    expect(hashRequestBody({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('readIdempotencyKey', () => {
  it('returns undefined when the header is absent', () => {
    expect(readIdempotencyKey(undefined)).toBeUndefined();
  });

  it('returns the trimmed value when within length', () => {
    expect(readIdempotencyKey('  abc  ')).toBe('abc');
  });

  it('returns the first value when the header is sent multiple times', () => {
    // The first value is what reaching the server first. A joined value is
    // not a valid single key.
    expect(readIdempotencyKey(['first', 'second'])).toBe('first');
  });

  it('returns undefined for an over-long key (does not reject the request)', () => {
    // The design choice: an unhealthy key degrades to "no idempotency" rather
    // than to a 400. A retrying client harmlessly appends suffixes; we do not
    // want to break that.
    const long = 'x'.repeat(300);
    expect(readIdempotencyKey(long)).toBeUndefined();
  });

  it('returns undefined for a whitespace-only key', () => {
    expect(readIdempotencyKey('   ')).toBeUndefined();
  });
});