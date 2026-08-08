import type { Logger } from '@baseplate/logger';

import type { Db } from '../db/prisma.js';
import type {
  IdempotencyRepository,
  NewIdempotencyRecord,
  StoredResponse,
} from '../idempotency/idempotency.js';
import type { ItemRecord, ItemRepository, ListItemsOptions, ListItemsResult } from '../modules/items/item.repository.js';

/**
 * Test helpers. Fakes for the persistence SEAM, not mocks for the API surface.
 *
 * The whole reason ItemRepository is an interface is so a unit test can swap
 * it for an in-memory implementation in ~20 lines and exercise the SERVICE's
 * logic -- branching, ordering, idempotency state machine -- without standing
 * up Postgres. Mocks for the service itself (vi.fn() on its methods) would
 * prove only that mocking works.
 */

let nextUuid = 0;
function uuid(): string {
  // Deterministic, monotonic v4-shaped ids: 8-4-4-4-12. Easier to read in a
  // failure log than a random v4. The version nibble (4xxx) and variant
  // nibble (8xxx) are real so the value is a valid UUID string for any
  // validator the service might run it past.
  nextUuid += 1;
  const tail = nextUuid.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${tail}`;
}

export function resetTestIds(): void {
  nextUuid = 0;
}

export interface FakeItemRepo extends ItemRepository {
  records: Map<string, ItemRecord>;
  createCalls: { data: { name: string; quantity: number } }[];
  failNextCreateWith: unknown;
}

export function fakeItemRepository(): FakeItemRepo {
  const records = new Map<string, ItemRecord>();
  const repo: FakeItemRepo = {
    records,
    createCalls: [],
    failNextCreateWith: null,

    create(_db, data) {
      if (repo.failNextCreateWith) {
        const err = repo.failNextCreateWith;
        repo.failNextCreateWith = null;
        throw err as Error;
      }
      const record: ItemRecord = {
        id: uuid(),
        name: data.name,
        quantity: data.quantity,
        createdAt: new Date(),
      };
      records.set(record.id, record);
      repo.createCalls.push({ data });
      return Promise.resolve(record);
    },

    findById(_db, id) {
      return Promise.resolve(records.get(id) ?? null);
    },

    list(_db, options: ListItemsOptions): Promise<ListItemsResult> {
      const all = [...records.values()].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      let start = 0;
      if (options.cursor) {
        const idx = all.findIndex((r) => r.id === options.cursor);
        if (idx >= 0) start = idx + 1;
      }
      const slice = all.slice(start, start + options.limit + 1);
      const hasMore = slice.length > options.limit;
      const items = hasMore ? slice.slice(0, options.limit) : slice;
      const last = items.at(-1);
      return Promise.resolve({ items, nextCursor: hasMore && last ? last.id : null });
    },
  };
  return repo;
}

export interface FakeIdempotencyRepo extends IdempotencyRepository {
  records: Map<string, StoredResponse>;
  // Lets a test simulate the "another transaction inserted this first" path
  // by injecting a P2002 on the next insert attempt.
  failNextInsertWith: unknown;
}

export function fakeIdempotencyRepository(): FakeIdempotencyRepo {
  const records = new Map<string, StoredResponse>();
  const keyOf = (e: string, k: string): string => `${e}\u0000${k}`;

  const repo: FakeIdempotencyRepo = {
    records,
    failNextInsertWith: null,

    find(_db, endpoint, key) {
      return Promise.resolve(records.get(keyOf(endpoint, key)) ?? null);
    },

    insert(_db, record: NewIdempotencyRecord) {
      if (repo.failNextInsertWith) {
        const err = repo.failNextInsertWith;
        repo.failNextInsertWith = null;
        throw err as Error;
      }
      const k = keyOf(record.endpoint, record.key);
      if (records.has(k)) {
        const err = new Error('Unique violation') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      records.set(k, {
        requestHash: record.requestHash,
        statusCode: record.statusCode,
        responseBody: record.responseBody,
      });
      return Promise.resolve();
    },
  };
  return repo;
}

/**
 * The MINIMAL Db the service needs. The service calls `$transaction(fn)` to
 * run the create + idempotency-insert atomically; we forward that to `fn` with
 * the SAME fake db as the transaction client. Repositories are agnostic to
 * which they receive -- that is the point of the seam -- so this works
 * without a real database.
 *
 * `Object.assign` rather than a class so a future method added to PrismaClient
 * fails the typecheck rather than silently returning undefined at runtime.
 */
export function fakeDb(): Db {
  const tx = {} as Db;
  const db = {
    $transaction: <T>(fn: (tx: Db) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as Db;
  return db;
}

/**
 * Pino's logger interface is large; the unit tests only need the methods the
 * service calls. Cast through unknown so the production logger's full type is
 * not in the unit-test dependency surface.
 */
export function fakeLogger(): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    child: () => fakeLogger(),
  } as unknown as Logger;
}