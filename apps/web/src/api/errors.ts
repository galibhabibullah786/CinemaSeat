import type { ErrorCode, ValidationIssue } from '@baseplate/contracts';

/**
 * A failure that reached us from (or on the way to) the API.
 *
 * `serverMessage` is captured for the CONSOLE and for a support ticket. It is
 * deliberately NOT what the UI renders -- see `userMessageFor` below.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK' | 'TIMEOUT' | 'MALFORMED_RESPONSE',
    readonly status: number,
    /** Correlates with the server log line. Shown to the user so they can
     *  quote it; that is the entire reason it is in the error envelope. */
    readonly requestId: string | undefined,
    readonly serverMessage: string,
    readonly details?: ValidationIssue[],
  ) {
    super(serverMessage);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Maps a failure to copy WE own.
 *
 * The rule this enforces: never render a server-supplied string. Two reasons,
 * and the second is the one people forget:
 *   1. Server messages leak internals -- a driver error, a constraint name, a
 *      file path -- straight into the UI and into screenshots.
 *   2. A server message is not localised, not proofread, and can change in a
 *      backend refactor, silently rewriting your product's copy.
 *
 * Validation is the one case where the server's FIELD PATHS are surfaced, and
 * even there the sentence shown is ours.
 */
export function userMessageFor(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Please try again.';
  }

  switch (error.code) {
    case 'NETWORK':
      return 'Could not reach the server. Check your connection and try again.';
    case 'TIMEOUT':
      return 'The server took too long to respond. Please try again.';
    case 'VALIDATION_FAILED':
      return firstFieldProblem(error.details) ?? 'Please check the form and try again.';
    case 'NOT_FOUND':
      return 'That item no longer exists.';
    case 'CONFLICT':
    case 'IDEMPOTENCY_KEY_CONFLICT':
      return 'That change conflicted with another update. Please retry.';
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment and try again.';
    case 'PAYLOAD_TOO_LARGE':
      return 'That request was too large.';
    case 'SERVICE_UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again shortly.';
    case 'MALFORMED_RESPONSE':
    case 'INTERNAL':
    default:
      return 'Something went wrong on our end. Please try again.';
  }
}

/**
 * Turn the first validation issue into a sentence.
 *
 * The field PATH comes from the server, but it is the client's own field name
 * echoed back -- it describes the payload we sent, not server internals.
 */
function firstFieldProblem(details: ValidationIssue[] | undefined): string | undefined {
  const first = details?.[0];
  if (!first) return undefined;
  const field = first.path === '(body)' ? 'request' : first.path;
  return `${field}: ${first.message}`;
}
