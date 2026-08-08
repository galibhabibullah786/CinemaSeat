import type { z } from 'zod';

import { ValidationError } from '../domain/errors.js';
import { toIssues } from './middleware/error-handler.js';

/**
 * Parse untrusted input or throw a typed domain error.
 *
 * This is the ONLY sanctioned way data enters the application. The return type
 * is the schema's OUTPUT type, so everything downstream -- handler, service,
 * repository -- receives values that are already coerced, defaulted and
 * range-checked. Nothing unvalidated crosses the boundary.
 *
 * Why a helper and not middleware: middleware cannot express "the handler now
 * has a `CreateItemInput`" in the type system without a lot of generic
 * machinery. Calling this at the top of a handler makes the validation step
 * visible in the code you are reading, and the compiler enforces that you used
 * the result rather than the raw `req.body`.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);

  if (!result.success) {
    // Field-level issues are surfaced to the caller; they describe the
    // caller's own payload and leak nothing about the server.
    throw new ValidationError(toIssues(result.error));
  }

  // zod types `safeParse().data` as the schema's inferred output, which the
  // generic erases to `any` from the caller's perspective. The assertion
  // restores the precise type; it is sound because zod guarantees the value
  // matches the schema on the success branch.
  return result.data as z.output<S>;
}
