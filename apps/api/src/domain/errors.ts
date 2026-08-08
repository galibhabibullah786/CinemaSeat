import type { ErrorCode, ValidationIssue } from '@baseplate/contracts';

/**
 * Typed domain errors.
 *
 * The domain layer throws these. It does NOT know about HTTP status codes --
 * that mapping belongs to the transport (see http/middleware/error-handler.ts).
 * Keeping the service free of `res.status(409)` is what lets the same service
 * be driven by a queue consumer or a CLI tomorrow without rewriting it.
 *
 * Two messages per error on purpose:
 *   - `message`  : for the log. May name internals.
 *   - `publicMessage`: for the user. Must never name internals.
 */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  /** Whether this represents a caller mistake (4xx) or ours (5xx). */
  abstract readonly isClientError: boolean;

  readonly publicMessage: string;
  readonly details?: ValidationIssue[];

  constructor(message: string, publicMessage?: string, details?: ValidationIssue[]) {
    super(message);
    this.name = new.target.name;
    this.publicMessage = publicMessage ?? message;
    if (details) this.details = details;
    // Without this, `instanceof` breaks for subclasses when targeting ES5-ish
    // output and the error middleware silently falls through to 500.
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED' as const;
  readonly isClientError = true;

  constructor(details: ValidationIssue[], message = 'Request validation failed') {
    super(message, 'The request was not valid.', details);
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly isClientError = true;

  /**
   * `resource` and `id` go to the LOG only. The public message is deliberately
   * generic: a 404 that says "Item 7f3.. not found" confirms which ids exist,
   * which is the read primitive of an enumeration attack.
   */
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'The requested resource was not found.');
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly isClientError = true;

  constructor(message: string, publicMessage = 'The request conflicts with the current state.') {
    super(message, publicMessage);
  }
}

export class SeatUnavailableError extends AppError {
  readonly code = 'SEAT_UNAVAILABLE' as const;
  readonly isClientError = true;

  constructor(message = 'The requested seat is not available for hold.') {
    super(message, 'This seat is unavailable or already held by another user.');
  }
}

/**
 * A second request arrived for an Idempotency-Key that is already taken, and it
 * is not a safe replay -- either a different body, or the original is still
 * in flight. Answering 409 immediately is deliberate: the alternative is to
 * block waiting for the winner, which converts a client retry storm into
 * exhausted connections.
 */
export class IdempotencyConflictError extends AppError {
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT' as const;
  readonly isClientError = true;

  constructor(message: string, publicMessage: string) {
    super(message, publicMessage);
  }
}

export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly isClientError = true;

  constructor(readonly retryAfterSeconds: number) {
    super('Rate limit exceeded', 'Too many requests. Please retry shortly.');
  }
}

/** A dependency we need is unavailable. Distinct from INTERNAL: this one is
 *  worth retrying, and monitoring should treat it differently. */
export class ServiceUnavailableError extends AppError {
  readonly code = 'SERVICE_UNAVAILABLE' as const;
  readonly isClientError = false;

  constructor(message: string) {
    super(message, 'The service is temporarily unavailable. Please retry.');
  }
}
