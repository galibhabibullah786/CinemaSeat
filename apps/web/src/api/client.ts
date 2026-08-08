import { ErrorEnvelopeSchema } from '@baseplate/contracts';
import type { z } from 'zod';

import { ApiError } from './errors.js';

/**
 * THE API client. Every network call in this app goes through `request`.
 *
 * Why one client instead of `fetch` in components:
 *   - the base URL, timeout, credentials and correlation header are decided
 *     once, so they cannot drift between call sites;
 *   - error handling is uniform, so a component never has to remember that a
 *     409 means something different from a 500;
 *   - responses are validated against the shared schema, so a backend change
 *     fails HERE with a clear message rather than as `undefined.map` three
 *     components deep.
 */

/**
 * Resolved once at module load.
 *
 * `import.meta.env.VITE_API_URL` is replaced with a literal at build time.
 * The production build refuses to run without it (see vite.config.ts); the
 * fallback below therefore only ever applies to `vite dev`.
 */
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Every request is bounded. An un-timed-out fetch is a spinner that never
 *  stops -- the browser's own default is minutes. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Sent as `Idempotency-Key`. Safe to retry a write that carries one. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const {
    method = 'GET',
    body,
    idempotencyKey,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  /**
   * Combine the caller's abort signal (component unmounted) with our timeout.
   * `AbortSignal.any` is used when available so that neither reason is lost;
   * the fallback keeps this working on older Safari.
   */
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined =
    signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, timeoutSignal])
      : (signal ?? timeoutSignal);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      // The API's CORS config allows credentials for the listed origins.
      credentials: 'include',
      signal: combined,
    });
  } catch (cause) {
    // fetch rejects for DNS failure, connection refused, CORS block and abort.
    // The browser deliberately does not say which -- distinguishing them would
    // be a cross-origin information leak. Timeout is the one we can identify.
    const isTimeout = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new ApiError(
      isTimeout ? 'TIMEOUT' : 'NETWORK',
      0,
      undefined,
      isTimeout ? `Request to ${path} timed out` : `Network request to ${path} failed`,
    );
  }

  // 204 and friends have no body; parsing one would throw on empty input.
  const rawText = response.status === 204 ? '' : await response.text();
  const parsedJson = safeJsonParse(rawText);

  if (!response.ok) throw toApiError(response, parsedJson);

  /**
   * Validate the SUCCESS payload too.
   *
   * This is the seam that makes the shared contracts package worth having: if
   * the API renames a field, the failure is a single explicit error naming the
   * field, at the boundary -- not a cascade of undefined reads in the UI.
   */
  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    // Full detail to the console for the developer; the user gets generic copy.
    console.error(`Response from ${path} did not match its schema`, result.error.issues);
    throw new ApiError(
      'MALFORMED_RESPONSE',
      response.status,
      response.headers.get('x-request-id') ?? undefined,
      `Response from ${path} did not match the expected schema`,
    );
  }

  return result.data as z.output<S>;
}

/** Never throws. A malformed error body must not mask the real HTTP failure. */
function safeJsonParse(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Build an ApiError from a non-2xx response.
 *
 * The envelope is itself validated. A 502 from a proxy returns HTML, not our
 * JSON shape -- assuming `body.error.code` exists there is a TypeError inside
 * the error path, which is the hardest kind of bug to read in a stack trace.
 */
function toApiError(response: Response, body: unknown): ApiError {
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  const headerRequestId = response.headers.get('x-request-id') ?? undefined;

  if (!envelope.success) {
    return new ApiError(
      response.status >= 500 ? 'INTERNAL' : 'MALFORMED_RESPONSE',
      response.status,
      headerRequestId,
      `HTTP ${response.status} with an unrecognised error body`,
    );
  }

  const { code, message, requestId, details } = envelope.data.error;
  return new ApiError(code, response.status, requestId || headerRequestId, message, details);
}

/** Exposed for the readiness indicator and for diagnostics in the UI. */
export const apiBaseUrl = API_BASE_URL;
