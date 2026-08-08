import type { Logger } from '@baseplate/logger';

import type { Db } from '../db/prisma.js';
import type {
  IdempotencyRepository,
  NewIdempotencyRecord,
  StoredResponse,
} from '../idempotency/idempotency.js';

let nextUuid = 0;
export function uuid(): string {
  nextUuid += 1;
  const tail = nextUuid.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${tail}`;
}

export function resetTestIds(): void {
  nextUuid = 0;
}

export interface FakeIdempotencyRepo extends IdempotencyRepository {
  records: Map<string, StoredResponse>;
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

export function fakeDb(): Db {
  const tx = {} as Db;
  const db = {
    $transaction: <T>(fn: (tx: Db) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as Db;
  return db;
}

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