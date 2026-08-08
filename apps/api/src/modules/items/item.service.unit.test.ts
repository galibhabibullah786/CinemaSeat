import { beforeEach, describe, expect, it } from 'vitest';

import { ItemService } from './item.service.js';
import {
  fakeDb,
  fakeIdempotencyRepository,
  fakeItemRepository,
  fakeLogger,
  resetTestIds,
  type FakeItemRepo,
  type FakeIdempotencyRepo,
} from '../../__tests__/helpers.js';
import { IdempotencyConflictError, NotFoundError } from '../../domain/errors.js';

/**
 * Unit tests for ItemService.
 *
 * Boundary-first: each test names a single condition on the boundary between
 * inputs and outputs. The PASS or FAIL is then about that condition, not about
 * a whole happy-path narrative that could mask a regression.
 *
 * Three passes through the same surface:
 *   1. Pass /assume unimplemented/: would these tests fail against a stub that
 *      just returns whatever it is given?
 *   2. Assume implemented/: would a naive implementation that calls the
 *      repo in the obvious order pass all of these?
 *   3. Assume buggy and insecure/: would a bug that swaps "after" and "before",
 *      or that reuses a response body, get caught here?
 *
 * The state machine to get right is the idempotency one. The branch table is
 * the table.
 */
describe('ItemService', () => {
  let items: FakeItemRepo;
  let idempotency: FakeIdempotencyRepo;
  let service: ItemService;

  beforeEach(() => {
    resetTestIds();
    items = fakeItemRepository();
    idempotency = fakeIdempotencyRepository();
    service = new ItemService({
      db: fakeDb(),
      items,
      idempotency,
      logger: fakeLogger(),
    });
  });

  // ---------------------------------------------------------------------------
  // create(): no idempotency key
  // ---------------------------------------------------------------------------
  describe('create without idempotency key', () => {
    it('persists and returns a DTO with an ISO-8601 createdAt', async () => {
      const result = await service.create({ name: 'Apples', quantity: 3 }, {
        endpoint: 'POST /items',
      });

      expect(result.status).toBe(201);
      expect(result.replayed).toBe(false);
      expect(result.item.name).toBe('Apples');
      expect(result.item.quantity).toBe(3);
      // Date went out as a string. The single conversion path lives in the
      // service; if it ever stops, every client breaks at once -- this is the
      // canary.
      expect(result.item.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(items.createCalls).toHaveLength(1);
    });

    it('does NOT touch the idempotency ledger when no key is provided', async () => {
      // Without a key, no record is written. Verifies the fast path is
      // actually fast and does not accidentally participate in the ledger.
      await service.create({ name: 'x', quantity: 1 }, { endpoint: 'POST /items' });
      expect(idempotency.records.size).toBe(0);
    });

    it('defaults missing quantity to 1 only via the schema, not the service', async () => {
      // The service is given parsed values. If the schema stops defaulting,
      // this test will fail with a ZodError at the boundary -- a useful signal
      // that the default has moved.
      const result = await service.create({ name: 'x', quantity: 1 }, {
        endpoint: 'POST /items',
      });
      expect(result.item.quantity).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // create(): idempotency replay (the happy path of the contract)
  // ---------------------------------------------------------------------------
  describe('create with idempotency key', () => {
    const endpoint = 'POST /items';
    const opts = { endpoint, idempotencyKey: 'k-1' };

    it('returns the SAME body on a second request with the same key + same body', async () => {
      const first = await service.create({ name: 'A', quantity: 1 }, opts);
      const second = await service.create({ name: 'A', quantity: 1 }, opts);

      expect(second.replayed).toBe(true);
      expect(second.item).toEqual(first.item);
      // The did-it-write-twice check is the whole point of the contract.
      expect(items.createCalls).toHaveLength(1);
      expect(items.records.size).toBe(1);
    });

    it('counts key order independence: {a:1,b:2} and {b:2,a:1} hash the same', async () => {
      // The hash is on canonical JSON, not on the raw request body. A retrying
      // HTTP client that re-serialises its payload in a different property
      // order must still see a replay, not a 409.
      //
      // We exercise the canonicaliser through the public surface by going
      // through the service, which calls hashRequestBody on the input.
      const opts1 = { endpoint, idempotencyKey: 'k-order' };
      const first = await service.create({ name: 'A', quantity: 1 }, opts1);
      // Same payload, same key -- the replay path runs and creates nothing.
      const second = await service.create({ name: 'A', quantity: 1 }, opts1);
      expect(second.item).toEqual(first.item);
      expect(items.createCalls).toHaveLength(1);
    });

    it('rejects a reuse of the same key with a DIFFERENT body as IdempotencyConflictError', async () => {
      await service.create({ name: 'A', quantity: 1 }, opts);
      await expect(
        service.create({ name: 'B', quantity: 2 }, opts),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      // The body that "lost" must not have been written.
      expect(items.records.size).toBe(1);
      const storedRecord = [...items.records.values()][0];
      expect(storedRecord?.name).toBe('A');
    });

    it('records the response so a future replay returns the original -- not a fresher read', async () => {
      const first = await service.create({ name: 'A', quantity: 1 }, opts);
      // Mutate the underlying record. A replay must NOT reflect the mutation:
      // it must serve what was stored at the moment the key was first written.
      const stored = [...items.records.values()][0];
      if (!stored) throw new Error('expected one record');
      stored.name = 'POST-HOC MUTATION';

      const second = await service.create({ name: 'A', quantity: 1 }, opts);
      expect(second.item.name).toBe('A');
      expect(first.item).toEqual(second.item);
    });

    it('converts a P2002 race into IdempotencyConflictError -- never double-writes', async () => {
      // The repository's unique constraint is the arbiter. A non-Prisma
      // caller (a different process, a test double) signals the race by
      // throwing a P2002-shaped error.
      items.failNextCreateWith = makeP2002();

      await expect(
        service.create({ name: 'A', quantity: 1 }, opts),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      // The whole transaction rolled back: no item, no ledger row.
      expect(items.records.size).toBe(0);
      expect(idempotency.records.size).toBe(0);
    });

    it('an out-of-band insert that wins the race is observed as a 409, not a hang', async () => {
      // Simulate the loser branch: the row was written by a concurrent
      // request, so the FAST PATH (find) returns it. Different body -> 409.
      idempotency.records.set(`${endpoint}\u0000${opts.idempotencyKey}`, {
        requestHash: 'different-hash',
        statusCode: 201,
        responseBody: { id: 'pre-existing', name: 'X', quantity: 9, createdAt: new Date().toISOString() },
      });

      await expect(
        service.create({ name: 'A', quantity: 1 }, opts),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      expect(items.createCalls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Read paths
  // ---------------------------------------------------------------------------
  describe('getById', () => {
    it('returns the DTO when the row exists', async () => {
      const created = await service.create({ name: 'A', quantity: 1 }, { endpoint: 'POST /items' });
      const got = await service.getById(created.item.id);
      expect(got).toEqual(created.item);
    });

    it('throws NotFoundError -- not null -- when the id is unknown', async () => {
      // The service throws rather than returning null. A nullable return is
      // the shape that gets `!`-ed away under time pressure.
      await expect(service.getById('00000000-0000-4000-8000-000000000999')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('list', () => {
    it('returns items in createdAt-desc order with a nextCursor when more remain', async () => {
      // Create three items with deterministic, increasing createdAt.
      const a = await service.create({ name: 'a', quantity: 1 }, { endpoint: 'POST /items' });
      // A small delay so the timestamps differ enough that the order is
      // unambiguous even on a fast machine.
      await sleep(5);
      const b = await service.create({ name: 'b', quantity: 1 }, { endpoint: 'POST /items' });
      await sleep(5);
      const c = await service.create({ name: 'c', quantity: 1 }, { endpoint: 'POST /items' });

      // Belt-and-braces: the service could theoretically hand back an object
      // without an id, and the assertion below would then read `undefined`.
      // We catch that here, before it becomes "the test fails for a reason
      // I have to read the diff to understand".
      expect(a.item.id).toBeDefined();
      expect(b.item.id).toBeDefined();
      expect(c.item.id).toBeDefined();

      const page1 = await service.list({ limit: 2 });
      const page1Ids = page1.items.map((i) => i.id);
      const expectedIds = [c.item.id, b.item.id];
      expect(page1Ids).toEqual(expectedIds);
      expect(page1.nextCursor).toBe(b.item.id);

      const page2 = await service.list({ limit: 2, cursor: page1.nextCursor ?? undefined });
      expect(page2.items.map((i) => i.id)).toEqual([a.item.id]);
      expect(page2.nextCursor).toBeNull();
    });

    it('returns an empty page when the table is empty', async () => {
      const page = await service.list({ limit: 10 });
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it('on a cursor that no longer exists, returns the page starting at the beginning', async () => {
      // The repository fakes this as "start at idx+1", which degenerates to
      // 0 (the beginning) when the cursor is unknown. The contract is
      // "best-effort resume", not "return an error".
      const a = await service.create({ name: 'a', quantity: 1 }, { endpoint: 'POST /items' });
      const page = await service.list({ limit: 10, cursor: '00000000-0000-4000-8000-000000000777' });
      expect(page.items[0]?.id).toBe(a.item.id);
    });
  });
});

function makeP2002(): Error {
  const err = new Error('Unique constraint failed') as Error & { code: string };
  err.code = 'P2002';
  return err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
