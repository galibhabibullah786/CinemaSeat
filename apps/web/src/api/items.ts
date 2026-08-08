import {
  ItemListResponseSchema,
  ItemSchema,
  type CreateItemBody,
  type Item,
  type ItemListResponse,
} from '@baseplate/contracts';

import { request } from './client.js';

/**
 * DEMO DOMAIN -- deleted by `make reset-domain`.
 *
 * Note what is NOT here: no type declarations. `Item`, `CreateItemBody` and
 * `ItemListResponse` all come from @baseplate/contracts, which derives them
 * from the same zod schemas the server validates against. The web app cannot
 * disagree with the API about a field name, because there is only one
 * declaration of it in the repository.
 */

export function listItems(options: { signal?: AbortSignal; limit?: number } = {}): Promise<ItemListResponse> {
  const limit = options.limit ?? 50;
  return request(`/items?limit=${String(limit)}`, ItemListResponseSchema, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export function createItem(
  body: CreateItemBody,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<Item> {
  return request('/items', ItemSchema, {
    method: 'POST',
    body,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * A fresh key per submit ATTEMPT, reused across retries of that attempt.
 *
 * This is the client half of the idempotency contract: without a stable key,
 * a user double-clicking "Add" -- or a flaky network causing a retry after the
 * server already committed -- creates two items. `crypto.randomUUID` is
 * available in every browser this app targets and over HTTPS/localhost only,
 * which is where the app runs.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
