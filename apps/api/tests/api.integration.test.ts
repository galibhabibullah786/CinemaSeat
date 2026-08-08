import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { Express } from 'express';

import type { Db } from '../src/db/prisma.js';
import { createPrismaClient, probeDatabase } from '../src/db/prisma.js';
import { createApp } from '../src/app.js';
import { PrismaCinemaRepository } from '../src/modules/cinema/cinema.prisma-repository.js';
import { CinemaService } from '../src/modules/cinema/cinema.service.js';
import { createLogger, type Logger } from '@baseplate/logger';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:55433/baseplate_test?schema=public';

let db: Db;
let logger: Logger;
let app: Express;
let movieTable: { deleteMany(): Promise<unknown>; create(data: any): Promise<any> };
let theatreTable: { deleteMany(): Promise<unknown>; create(data: any): Promise<any> };
let screenTable: { deleteMany(): Promise<unknown>; create(data: any): Promise<any> };
let seatTable: { deleteMany(): Promise<unknown>; create(data: any): Promise<any> };
let showtimeTable: { deleteMany(): Promise<unknown>; create(data: any): Promise<any> };
let seatInventoryTable: { deleteMany(): Promise<unknown>; create(data: any): Promise<any> };
let bookingTable: { deleteMany(): Promise<unknown>; count(where?: any): Promise<number> };

beforeAll(async () => {
  logger = createLogger({ name: 'test', level: 'warn', pretty: false, base: {} });
  db = createPrismaClient({ databaseUrl: TEST_DATABASE_URL, logger, logQueries: false });

  expect(TEST_DATABASE_URL).toContain('test');
  const probe = await probeDatabase(db, 2_000);
  expect(probe.ok).toBe(true);

  movieTable = (db as any).movie;
  theatreTable = (db as any).theatre;
  screenTable = (db as any).screen;
  seatTable = (db as any).seat;
  showtimeTable = (db as any).showtime;
  seatInventoryTable = (db as any).seatInventory;
  bookingTable = (db as any).booking;

  const cinemaService = new CinemaService({
    db,
    cinema: new PrismaCinemaRepository(),
    logger,
    env: { HOLD_TTL_SECONDS: 600 },
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
      RATE_LIMIT_WRITE_MAX: 1_000,
      SHUTDOWN_TIMEOUT_MS: 5_000,
      HOLD_TTL_SECONDS: 600,
      APP_VERSION: 'test',
    },
    db,
    logger,
    isShuttingDown: () => false,
  });

  void cinemaService;
});

beforeEach(async () => {
  await (db as any).bookingSeat.deleteMany();
  await bookingTable.deleteMany();
  await seatInventoryTable.deleteMany();
  await showtimeTable.deleteMany();
  await seatTable.deleteMany();
  await screenTable.deleteMany();
  await theatreTable.deleteMany();
  await movieTable.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

// ============================================================================
// Movies + Showtimes read endpoints
// ============================================================================
describe('CinemaSeat read endpoints', () => {
  it('GET /movies returns seeded movies', async () => {
    await movieTable.create({
      data: {
        id: 'dune-2',
        title: 'Dune: Part Two',
        synopsis: 'A test synopsis',
        durationMinutes: 166,
        certificate: 'PG-13',
        genres: ['Sci-Fi'],
      },
    });

    const res = await request(app).get('/movies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Dune: Part Two');
  });

  it('GET /movies/:id returns single movie or 404', async () => {
    await movieTable.create({
      data: {
        id: 'dune-2',
        title: 'Dune: Part Two',
        durationMinutes: 166,
      },
    });

    const res = await request(app).get('/movies/dune-2');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('dune-2');

    const notFound = await request(app).get('/movies/non-existent');
    expect(notFound.status).toBe(404);
  });

  it('GET /showtimes filters by movieId and returns seat counts', async () => {
    const movie = await movieTable.create({
      data: { id: 'm1', title: 'Test Movie', durationMinutes: 120 },
    });
    const theatre = await theatreTable.create({
      data: { id: 't1', name: 'Test Theatre' },
    });
    const screen = await screenTable.create({
      data: { id: 'sc1', theatreId: theatre.id, name: 'Screen 1', capacity: 2 },
    });
    const seat1 = await seatTable.create({
      data: { id: 'seat1', screenId: screen.id, rowLabel: 'A', seatNumber: 1, priceCents: 1000 },
    });
    const seat2 = await seatTable.create({
      data: { id: 'seat2', screenId: screen.id, rowLabel: 'A', seatNumber: 2, priceCents: 1000 },
    });

    const showtime = await showtimeTable.create({
      data: {
        id: 'st1',
        movieId: movie.id,
        theatreId: theatre.id,
        screenId: screen.id,
        startsAt: new Date(),
        priceCents: 1000,
      },
    });

    await seatInventoryTable.create({
      data: { showtimeId: showtime.id, seatId: seat1.id, status: 'AVAILABLE', priceCents: 1000 },
    });
    await seatInventoryTable.create({
      data: { showtimeId: showtime.id, seatId: seat2.id, status: 'BOOKED', priceCents: 1000 },
    });

    const res = await request(app).get('/showtimes?movieId=m1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].availableSeats).toBe(1);
    expect(res.body[0].totalSeats).toBe(2);
  });

  it('GET /showtimes/:id/seats returns seat map and displays expired HELD seat as AVAILABLE', async () => {
    const movie = await movieTable.create({
      data: { id: 'm1', title: 'Test Movie', durationMinutes: 120 },
    });
    const theatre = await theatreTable.create({
      data: { id: 't1', name: 'Test Theatre' },
    });
    const screen = await screenTable.create({
      data: { id: 'sc1', theatreId: theatre.id, name: 'Screen 1', capacity: 1 },
    });
    const seat = await seatTable.create({
      data: { id: 'seat1', screenId: screen.id, rowLabel: 'A', seatNumber: 1, priceCents: 1000 },
    });
    const showtime = await showtimeTable.create({
      data: {
        id: 'st1',
        movieId: movie.id,
        theatreId: theatre.id,
        screenId: screen.id,
        startsAt: new Date(),
        priceCents: 1000,
      },
    });

    const pastDate = new Date(Date.now() - 60_000);
    await seatInventoryTable.create({
      data: { showtimeId: showtime.id, seatId: seat.id, status: 'HELD', heldUntil: pastDate, priceCents: 1000 },
    });

    const res = await request(app).get('/showtimes/st1/seats');
    expect(res.status).toBe(200);
    expect(res.body.showtimeId).toBe('st1');
    expect(res.body.seats).toHaveLength(1);
    expect(res.body.seats[0].label).toBe('A1');
    expect(res.body.seats[0].status).toBe('AVAILABLE');
  });
});

// ============================================================================
// Single-seat holding endpoints & ownership verification
// ============================================================================
describe('POST /bookings & hold ownership', () => {
  async function seedShowtimeWithSeat() {
    const movie = await movieTable.create({
      data: { id: 'm1', title: 'Test Movie', durationMinutes: 120 },
    });
    const theatre = await theatreTable.create({
      data: { id: 't1', name: 'Test Theatre' },
    });
    const screen = await screenTable.create({
      data: { id: 'sc1', theatreId: theatre.id, name: 'Screen 1', capacity: 1 },
    });
    const seat = await seatTable.create({
      data: { id: 'seat1', screenId: screen.id, rowLabel: 'A', seatNumber: 1, priceCents: 1500 },
    });
    const showtime = await showtimeTable.create({
      data: {
        id: 'st1',
        movieId: movie.id,
        theatreId: theatre.id,
        screenId: screen.id,
        startsAt: new Date(),
        priceCents: 1500,
      },
    });

    await seatInventoryTable.create({
      data: { showtimeId: showtime.id, seatId: seat.id, status: 'AVAILABLE', priceCents: 1500 },
    });

    return { showtimeId: showtime.id, seatId: seat.id };
  }

  it('first hold succeeds and sets holdingBookingId', async () => {
    const { showtimeId, seatId } = await seedShowtimeWithSeat();

    const res = await request(app).post('/bookings').send({ showtimeId, seatId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('HELD');
    expect(res.body.ref).toMatch(/^CS-\d{4}-\d+/);
    expect(res.body.amountCents).toBe(1500);

    const inv = await db.seatInventory.findUnique({
      where: { showtimeId_seatId: { showtimeId, seatId } },
    });
    expect(inv?.status).toBe('HELD');
    expect(inv?.holdingBookingId).toBe(res.body.id);
  });

  it('second hold on the same seat returns 409 SEAT_UNAVAILABLE', async () => {
    const { showtimeId, seatId } = await seedShowtimeWithSeat();

    const first = await request(app).post('/bookings').send({ showtimeId, seatId });
    expect(first.status).toBe(201);

    const second = await request(app).post('/bookings').send({ showtimeId, seatId });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SEAT_UNAVAILABLE');
  });

  it('expired hold can be reclaimed by User B', async () => {
    const { showtimeId, seatId } = await seedShowtimeWithSeat();

    const userA = await request(app).post('/bookings').send({ showtimeId, seatId });
    expect(userA.status).toBe(201);

    const pastDate = new Date(Date.now() - 30_000);
    await db.seatInventory.update({
      where: { showtimeId_seatId: { showtimeId, seatId } },
      data: { status: 'HELD', heldUntil: pastDate },
    });

    const userB = await request(app).post('/bookings').send({ showtimeId, seatId });
    expect(userB.status).toBe(201);
    expect(userB.body.status).toBe('HELD');

    const inv = await db.seatInventory.findUnique({
      where: { showtimeId_seatId: { showtimeId, seatId } },
    });
    expect(inv?.holdingBookingId).toBe(userB.body.id);
  });

  it('User A deleting expired hold does NOT release User B hold', async () => {
    const { showtimeId, seatId } = await seedShowtimeWithSeat();

    const userA = await request(app).post('/bookings').send({ showtimeId, seatId });
    expect(userA.status).toBe(201);

    const pastDate = new Date(Date.now() - 30_000);
    await db.seatInventory.update({
      where: { showtimeId_seatId: { showtimeId, seatId } },
      data: { status: 'HELD', heldUntil: pastDate },
    });

    const userB = await request(app).post('/bookings').send({ showtimeId, seatId });
    expect(userB.status).toBe(201);

    const deleteA = await request(app).delete(`/bookings/${userA.body.ref}/hold`);
    expect(deleteA.status).toBe(200);

    const inv = await db.seatInventory.findUnique({
      where: { showtimeId_seatId: { showtimeId, seatId } },
    });
    expect(inv?.status).toBe('HELD');
    expect(inv?.holdingBookingId).toBe(userB.body.id);
  });

  it('100 concurrent requests for one seat produce exactly 1 success, 99 conflicts, 0 oversell', async () => {
    const { showtimeId, seatId } = await seedShowtimeWithSeat();

    const requests = Array.from({ length: 100 }, () =>
      request(app).post('/bookings').send({ showtimeId, seatId }),
    );

    const responses = await Promise.all(requests);

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409 && r.body.error?.code === 'SEAT_UNAVAILABLE');

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(99);

    const bookingsCount = await db.booking.count({ where: { showtimeId } });
    expect(bookingsCount).toBe(1);
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
});