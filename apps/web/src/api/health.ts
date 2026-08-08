import { ReadyResponseSchema, type ReadyResponse } from '@baseplate/contracts';

import { request } from './client.js';

/**
 * Readiness of the API, used by the status dot in the header.
 *
 * Kept out of the demo-domain file on purpose: it survives `make reset-domain`
 * and is the fastest way to tell "the backend is down" from "my feature is
 * broken" during a hackathon demo.
 */
export function fetchReady(signal?: AbortSignal): Promise<ReadyResponse> {
  return request('/ready', ReadyResponseSchema, {
    ...(signal ? { signal } : {}),
    // Short: this powers an indicator, and a slow answer is itself the answer.
    timeoutMs: 4_000,
  });
}
