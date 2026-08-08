import { z } from 'zod';

/**
 * The uniform error envelope. Every non-2xx response from the API has exactly
 * this shape -- no exceptions, including 404s from the router and 500s from an
 * unhandled throw.
 *
 * Why a closed enum of codes rather than free-text: the web app must be able to
 * branch on failure without string-matching a human sentence that a future
 * commit will reword.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'SEAT_UNAVAILABLE',
  'IDEMPOTENCY_KEY_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * Field-level detail, populated for VALIDATION_FAILED only.
 *
 * Additive extension to the three-key envelope: it carries only the client's
 * OWN input path and a safe message, never a server internal. Without it the
 * web app can say "invalid" but not which field, which is a bad enough form UX
 * that teams work around it by parsing `message`.
 */
export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    /** Safe for display. Never contains a stack, SQL, hostname or internal id. */
    message: z.string(),
    /** Correlates this response with the server log line that produced it. */
    requestId: z.string(),
    details: z.array(ValidationIssueSchema).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
