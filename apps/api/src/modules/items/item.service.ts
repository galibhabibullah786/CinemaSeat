import type { CreateItemInput, Item, ItemListResponse, ListItemsParams } from '@baseplate/contracts';
import type { Logger } from '@baseplate/logger';

import { isPrismaErrorWithCode, UNIQUE_VIOLATION, type Db } from '../../db/prisma.js';
import { IdempotencyConflictError, NotFoundError } from '../../domain/errors.js';
import {
  hashRequestBody,
  type IdempotencyRepository,
} from '../../idempotency/idempotency.js';
import type { ItemRecord, ItemRepository } from './item.repository.js';

/** DEMO DOMAIN -- deleted by `make reset-domain`. */

export interface CreateItemOptions {
  /** Opaque client key. Absent means "no idempotency guarantee requested". */
  idempotencyKey?: string | undefined;
  /** Ledger scope, e.g. "POST /items". Keeps keys from colliding across routes. */
  endpoint: string;
}

export interface CreateItemResult {
  status: 201;
  item: Item;
  /** True when this response came from the ledger rather than a fresh write. */
  replayed: boolean;
}

export interface ItemServiceDeps {
  db: Db;
  items: ItemRepository;
  idempotency: IdempotencyRepository;
  logger: Logger;
}

/**
 * Business logic. Knows nothing about Express, status codes or headers -- it
 * takes parsed values and throws typed domain errors. That is what makes it
 * unit-testable with fakes and drivable from a queue consumer tomorrow.
 */
export class ItemService {
  constructor(private readonly deps: ItemServiceDeps) {}

  async list(params: ListItemsParams): Promise<ItemListResponse> {
    const { items, nextCursor } = await this.deps.items.list(this.deps.db, {
      limit: params.limit,
      cursor: params.cursor,
    });

    return { items: items.map(toDto), nextCursor };
  }

  async getById(id: string): Promise<Item> {
    const record = await this.deps.items.findById(this.deps.db, id);
    // Throwing here rather than returning null forces the caller to handle it;
    // a nullable return is the shape that gets `!`-ed away under time pressure.
    if (!record) throw new NotFoundError('Item', id);
    return toDto(record);
  }

  /**
   * Create an item, at most once per Idempotency-Key.
   *
   * REFERENCE IMPLEMENTATION -- this is the pattern to copy for the real
   * domain tomorrow. The three properties that make it correct:
   *
   *   1. The dedupe row and the business write are in the SAME transaction.
   *      Recording the key after the effect commits leaves a window where a
   *      crash produces the effect twice; recording it before leaves a window
   *      where a crash blocks a legitimate retry forever.
   *
   *   2. The UNIQUE CONSTRAINT is the arbiter, not an application-level check.
   *      The `find` below is a fast path for the common case (a retry seconds
   *      later). It is NOT the safety mechanism: two concurrent requests both
   *      read "not found" and both proceed. Only the database can order them.
   *
   *   3. The stored response is replayed verbatim. A retry must not observe a
   *      newer version of the resource -- that is what "idempotent" means to
   *      the client holding a receipt.
   */
  async create(input: CreateItemInput, options: CreateItemOptions): Promise<CreateItemResult> {
    const { idempotencyKey, endpoint } = options;

    if (!idempotencyKey) {
      const record = await this.deps.items.create(this.deps.db, input);
      return { status: 201, item: toDto(record), replayed: false };
    }

    const requestHash = hashRequestBody(input);

    // --- fast path: a completed request with this key already exists --------
    const stored = await this.deps.idempotency.find(this.deps.db, endpoint, idempotencyKey);
    if (stored) {
      if (stored.requestHash !== requestHash) {
        // Same key, different body. Replaying would return a response that does
        // not describe what was asked for; performing the write would break the
        // key's promise. Rejecting is the only honest option.
        throw new IdempotencyConflictError(
          `Idempotency-Key reused with a different body on ${endpoint}`,
          'This Idempotency-Key was already used with a different request body.',
        );
      }

      this.deps.logger.info({ endpoint }, 'idempotent replay served from ledger');
      return { status: 201, item: stored.responseBody as Item, replayed: true };
    }

    // --- slow path: perform the effect and record it atomically -------------
    try {
      return await this.deps.db.$transaction(
        async (tx) => {
          const record = await this.deps.items.create(tx, input);
          const item = toDto(record);

          // Same `tx`. Both rows commit together or neither does.
          await this.deps.idempotency.insert(tx, {
            endpoint,
            key: idempotencyKey,
            requestHash,
            statusCode: 201,
            responseBody: item,
          });

          return { status: 201 as const, item, replayed: false };
        },
        {
          // Bound the transaction so a stuck write cannot hold the unique-index
          // lock -- and therefore every concurrent retry of the same key --
          // indefinitely.
          maxWait: 2_000,
          timeout: 5_000,
        },
      );
    } catch (error) {
      if (isPrismaErrorWithCode(error, UNIQUE_VIOLATION)) {
        /**
         * Another transaction inserted this key first. The whole transaction
         * rolled back, so NO item was created -- exactly once is preserved.
         *
         * Honest caveat: the loser is not lock-free. Postgres makes the second
         * INSERT wait on the unique index until the winner commits or aborts,
         * so the wait is bounded by the winner's transaction (capped at 5s
         * above), not by a queue. It never waits on the *client*, and it never
         * deadlocks. Returning 409 rather than polling for the winner's result
         * keeps a retry storm from consuming the connection pool.
         */
        this.deps.logger.warn({ endpoint }, 'idempotency key race lost; returning 409');
        throw new IdempotencyConflictError(
          `Concurrent request already holds Idempotency-Key on ${endpoint}`,
          'A request with this Idempotency-Key is already being processed. Retry shortly.',
        );
      }
      throw error;
    }
  }
}

/**
 * Database record -> wire DTO.
 *
 * The one place `Date` becomes a string. Doing it here, rather than relying on
 * `JSON.stringify` to call `.toISOString()` implicitly, means the conversion is
 * visible, testable, and cannot be changed by a serialiser swap.
 */
function toDto(record: ItemRecord): Item {
  return {
    id: record.id,
    name: record.name,
    quantity: record.quantity,
    createdAt: record.createdAt.toISOString(),
  };
}
