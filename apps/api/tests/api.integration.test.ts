import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { Express } from 'express';

import type { Db } from '../src/db/prisma.js';
import { createPrismaClient, probeDatabase } from '../src/db/prisma.js';
import { createApp } from '../src/app.js';
import { PrismaIdempotencyRepository } from '../src/idempotency/prisma-idempotency.repository.js';
import { PrismaItemRepository } from '../src/modules/items/item.prisma-repository.js';
import { ItemService } from '../src/modules/items/item.service.js';
import { createLogger, type Logger } from '@baseplate/logger';

/**
 * Integration tests for the API surface.
 *
 * The contract these tests are PROVING:
 *   - zod validation at the boundary produces the documented envelope shape
 *     and never reaches the service.
 *   - POST /items with the same Idempotency-Key returns identical responses
 *     and never writes twice.
 *   - GET /ready flips to 503 when the database is unreachable, while
 *     /health stays 200.
 *   - Pagination, error envelopes, validation details, and location headers
 *     all behave as documented.
 *
 * Tests run against a real Postgres from scripts/with-test-db.sh, which sets
 * DATABASE_URL and applies migrations before this file loads. No mocks -- if
 * the schema is wrong, these tests fail.
 */

// ----------------------------------------------------------------------------
// Test fixture: build the real app with real repositories.
// ----------------------------------------------------------------------------

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:55433/baseplate_test?schema=public';

let db: Db;
let logger: Logger;
let app: Express;
let itemsTable: { deleteMany(): Promise<unknown>; count(): Promise<number> };
let idempotencyTable: { deleteMany(): Promise<unknown>; count(): Promise<number> };

beforeAll(async () => {
  logger = createLogger({ name: 'test', level: 'warn', pretty: false, base: {} });
  db = createPrismaClient({ databaseUrl: TEST_DATABASE_URL, logger, logQueries: false });

  // Sanity: confirm we are pointed at the test database, not production.
  // `kill -9` against a running dev database is the failure mode we are
  // designing out.
  expect(TEST_DATABASE_URL).toContain('test');
  const probe = await probeDatabase(db, 2_000);
  expect(probe.ok).toBe(true);

  // Reach into the generated client for the table helpers we need to
  // truncate between tests. This is the only place the integration suite
  // talks to the model directly -- everything else goes through the API.
  // The structural cast is necessary because the Prisma generated types
  // are not exposed for ad-hoc use; the runtime is correct.
  itemsTable = (db as unknown as {
    item: { deleteMany(): Promise<unknown>; count(): Promise<number> };
  }).item;
  idempotencyTable = (db as unknown as {
    idempotencyRecord: { deleteMany(): Promise<unknown>; count(): Promise<number> };
  }).idempotencyRecord;

  const itemService = new ItemService({
    db,
    items: new PrismaItemRepository(),
    idempotency: new PrismaIdempotencyRepository(),
    logger,
  });

  app = createApp({
    env: {
      NODE_ENV: 'test',
      API_PORT: 0,
      LOG_LEVEL: 'warn',
      DATABASE_URL: TEST_DATABASE_URL,
      CORS_ORIGINS: ['http://localhost'],
      BODY_LIMIT: '100kb',
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_WRITE_MAX: 1_000, // effectively off for these tests
      SHUTDOWN_TIMEOUT_MS: 5_000,
      APP_VERSION: 'test',
    },
    db,
    logger,
    isShuttingDown: () => false,
  });

  // Make the ItemService reachable for routes that need it. createApp already
  // wires it internally, so we do NOT need to mount it again here -- this is
  // for any test that wants to call the service directly.
  void itemService;
});

beforeEach(async () => {
  await itemsTable.deleteMany();
  await idempotencyTable.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

// ============================================================================
// Validation + error envelope
// ============================================================================
describe('POST /items validation', () => {
  it('rejects an empty body with a VALIDATION_FAILED envelope', async () => {
    const res = await request(app).post('/items').send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it('rejects a non-uuid id in the path with VALIDATION_FAILED, not 500', async () => {
    // A naive handler would forward "not-a-uuid" to Postgres and surface a
    // query error as a 500. We verify the zod gate fires first.
    const res = await request(app).get('/items/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 with the documented envelope for an unknown id', async () => {
    const res = await request(app).get('/items/00000000-0000-4000-8000-000000000999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // The public message MUST NOT name the resource or the id -- that would
    // be the read primitive of an enumeration attack.
    expect(res.body.error.message).toBe('The requested resource was not found.');
    expect(JSON.stringify(res.body.error)).not.toContain('00000000');
  });

  it('echoes the request id back on the response header', async () => {
    const supplied = 'test-req-id-' + Math.random().toString(36).slice(2);
    const res = await request(app).get('/health').set('x-request-id', supplied);
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(supplied);
  });
});

// ============================================================================
// Items happy paths
// ============================================================================
describe('items CRUD', () => {
  it('POST creates an item and returns 201 with a Location header', async () => {
    const res = await request(app).post('/items').send({ name: 'Apples', quantity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Apples');
    expect(res.body.quantity).toBe(3);
    expect(res.headers.location).toMatch(/^\/items\/[0-9a-f-]{36}$/);
  });

  it('GET /items/:id returns the created item', async () => {
    const created = await request(app).post('/items').send({ name: 'Bananas', quantity: 1 });
    const got = await request(app).get(`/items/${created.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(created.body.id);
  });

  it('GET /items paginates with a cursor', async () => {
    for (const name of ['a', 'b', 'c']) {
      await request(app).post('/items').send({ name, quantity: 1 });
    }
    const page1 = await request(app).get('/items?limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(app).get(`/items?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
  });
});

// ============================================================================
// Idempotency
// ============================================================================
describe('POST /items idempotency', () => {
  const KEY = 'integration-test-key-1';

  it('first request creates, second request returns the SAME body byte-for-byte', async () => {
    const body = { name: 'Same', quantity: 7 };

    const first = await request(app)
      .post('/items')
      .set('Idempotency-Key', KEY)
      .send(body);

    const second = await request(app)
      .post('/items')
      .set('Idempotency-Key', KEY)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers.location).toBe(first.headers.location);

    // Only ONE row in the table. This is the whole point.
    const count = await itemsTable.count();
    expect(count).toBe(1);

    // And the ledger has exactly one row.
    const ledger = await idempotencyTable.count();
    expect(ledger).toBe(1);
  });

  it('reusing the same key with a DIFFERENT body returns 409', async () => {
    const first = await request(app)
      .post('/items')
      .set('Idempotency-Key', KEY)
      .send({ name: 'A', quantity: 1 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/items')
      .set('Idempotency-Key', KEY)
      .send({ name: 'B', quantity: 2 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

    // Only the first row exists.
    const count = await itemsTable.count();
    expect(count).toBe(1);
  });

  it('omitting the header bypasses the ledger entirely', async () => {
    // Two requests, same body, no key. Both create -- at-most-once-per-attempt
    // semantics, not at-most-once-ever.
    await request(app).post('/items').send({ name: 'A', quantity: 1 });
    await request(app).post('/items').send({ name: 'A', quantity: 1 });
    expect(await itemsTable.count()).toBe(2);
    expect(await idempotencyTable.count()).toBe(0);
  });
});

// ============================================================================
// Health / readiness
// ============================================================================
describe('health endpoints', () => {
  it('GET /health returns 200 with uptime and version', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('test');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('GET /ready returns 200 when the database is reachable', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database.ok).toBe(true);
  });

  it('GET /ready returns 503 when the database is unreachable, but /health stays 200', async () => {
    // Build a SECOND app, pointed at a port nothing is listening on. This is
    // the cleanest way to exercise the /ready path against a dead DB without
    // poisoning the shared app for the other tests.
    const deadLogger = createLogger({ name: 'dead', level: 'warn', pretty: false, base: {} });
    const deadDb = createPrismaClient({
      databaseUrl:
        'postgresql://test:test@127.0.0.1:1/baseplate_test?schema=public&connection_limit=1',
      logger: deadLogger,
    });
    const deadApp = createApp({
      env: {
        NODE_ENV: 'test',
        API_PORT: 0,
        LOG_LEVEL: 'warn',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/baseplate_test',
        CORS_ORIGINS: ['http://localhost'],
        BODY_LIMIT: '100kb',
        RATE_LIMIT_WINDOW_MS: 60_000,
        RATE_LIMIT_WRITE_MAX: 1_000,
        SHUTDOWN_TIMEOUT_MS: 5_000,
        APP_VERSION: 'test',
      },
      db: deadDb,
      logger: deadLogger,
      isShuttingDown: () => false,
    });

    const ready = await request(deadApp).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('not_ready');
    expect(ready.body.checks.database.ok).toBe(false);

    const health = await request(deadApp).get('/health');
    expect(health.status).toBe(200);

    await deadDb.$disconnect();
  });

  it('GET /ready returns 503 when the shutdown sequence has been engaged', async () => {
    let shuttingDown = false;
    const sdLogger = createLogger({ name: 'sd', level: 'warn', pretty: false, base: {} });
    const sdDb = createPrismaClient({ databaseUrl: TEST_DATABASE_URL, logger: sdLogger });
    const sdApp = createApp({
      env: {
        NODE_ENV: 'test',
        API_PORT: 0,
        LOG_LEVEL: 'warn',
        DATABASE_URL: TEST_DATABASE_URL,
        CORS_ORIGINS: ['http://localhost'],
        BODY_LIMIT: '100kb',
        RATE_LIMIT_WINDOW_MS: 60_000,
        RATE_LIMIT_WRITE_MAX: 1_000,
        SHUTDOWN_TIMEOUT_MS: 5_000,
        APP_VERSION: 'test',
      },
      db: sdDb,
      logger: sdLogger,
      isShuttingDown: () => shuttingDown,
    });

    const ready = await request(sdApp).get('/ready');
    expect(ready.status).toBe(200); // sanity

    shuttingDown = true;
    const sdRes = await request(sdApp).get('/ready');
    expect(sdRes.status).toBe(503);
    expect(sdRes.body.checks.database.error).toBe('shutting_down');

    await sdDb.$disconnect();
  });
});