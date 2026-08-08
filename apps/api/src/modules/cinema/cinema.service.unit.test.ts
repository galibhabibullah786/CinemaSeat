import { describe, expect, it } from 'vitest';

import { SeatUnavailableError } from '../../domain/errors.js';
import type {
  BookingRecord,
  CinemaRepository,
  CreateBookingData,
  HeldSeatResult,
  MovieRecord,
  SeatInventoryRecord,
  ShowtimeRecord,
} from './cinema.repository.js';
import { CinemaService } from './cinema.service.js';

const mockLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => mockLogger,
};

const fakeEnv = { HOLD_TTL_SECONDS: 600 };

class InMemoryCinemaRepository implements CinemaRepository {
  movies: MovieRecord[] = [
    {
      id: 'dune-part-two',
      title: 'Dune: Part Two',
      synopsis: 'A test synopsis',
      posterUrl: 'https://example.com/poster.jpg',
      backdropUrl: 'https://example.com/backdrop.jpg',
      durationMinutes: 166,
      certificate: 'PG-13',
      genres: ['Sci-Fi'],
      createdAt: new Date(),
    },
  ];

  showtimes: ShowtimeRecord[] = [
    {
      id: 'st-dune-1',
      movieId: 'dune-part-two',
      theatreId: 'theatre-1',
      screenId: 'screen-1',
      startsAt: new Date(),
      priceCents: 1500,
      currency: 'USD',
      createdAt: new Date(),
      theatre: { name: 'CinemaSeat Grand' },
      screen: { name: 'Screen 1', capacity: 120 },
    },
  ];

  inventories: SeatInventoryRecord[] = [
    {
      id: 'inv-1',
      showtimeId: 'st-dune-1',
      seatId: 'seat-1',
      status: 'AVAILABLE',
      priceCents: 1500,
      heldUntil: null,
      holdingBookingId: null,
      updatedAt: new Date(),
      seat: {
        id: 'seat-1',
        rowLabel: 'A',
        seatNumber: 1,
        seatClass: 'Standard',
        priceCents: 1500,
      },
    },
    {
      id: 'inv-2',
      showtimeId: 'st-dune-1',
      seatId: 'seat-2',
      status: 'BOOKED',
      priceCents: 1500,
      heldUntil: null,
      holdingBookingId: null,
      updatedAt: new Date(),
      seat: {
        id: 'seat-2',
        rowLabel: 'A',
        seatNumber: 2,
        seatClass: 'Standard',
        priceCents: 1500,
      },
    },
  ];

  bookings = new Map<string, BookingRecord>();

  findMovies(): Promise<MovieRecord[]> {
    return Promise.resolve(this.movies);
  }

  findMovieById(_db: any, id: string): Promise<MovieRecord | null> {
    return Promise.resolve(this.movies.find((m) => m.id === id) ?? null);
  }

  findShowtimes(_db: any, movieId?: string): Promise<ShowtimeRecord[]> {
    if (movieId) return Promise.resolve(this.showtimes.filter((s) => s.movieId === movieId));
    return Promise.resolve(this.showtimes);
  }

  findShowtimeById(_db: any, id: string): Promise<ShowtimeRecord | null> {
    return Promise.resolve(this.showtimes.find((s) => s.id === id) ?? null);
  }

  findSeatMap(_db: any, showtimeId: string): Promise<SeatInventoryRecord[]> {
    return Promise.resolve(this.inventories.filter((i) => i.showtimeId === showtimeId));
  }

  countAvailableSeats(_db: any, showtimeId: string): Promise<number> {
    return Promise.resolve(this.inventories.filter((i) => i.showtimeId === showtimeId && i.status === 'AVAILABLE').length);
  }

  countTotalSeats(_db: any, showtimeId: string): Promise<number> {
    return Promise.resolve(this.inventories.filter((i) => i.showtimeId === showtimeId).length);
  }

  holdSeatAtomically(_db: any, showtimeId: string, seatId: string, heldUntil: Date, bookingId: string): Promise<HeldSeatResult | null> {
    const inv = this.inventories.find((i) => i.showtimeId === showtimeId && i.seatId === seatId);
    if (!inv) return Promise.resolve(null);
    if (inv.status !== 'AVAILABLE') return Promise.resolve(null);

    inv.status = 'HELD';
    inv.heldUntil = heldUntil;
    inv.holdingBookingId = bookingId;
    return Promise.resolve({
      inventoryId: inv.id,
      seatId: inv.seatId,
      priceCents: inv.priceCents,
    });
  }

  createBookingRecord(_db: any, data: CreateBookingData): Promise<BookingRecord> {
    const inv = this.inventories.find((i) => i.showtimeId === data.showtimeId && i.seatId === data.seatId);
    const rec: BookingRecord = {
      id: data.id ?? `b-${data.ref}`,
      ref: data.ref,
      showtimeId: data.showtimeId,
      status: data.status,
      amountCents: data.amountCents,
      currency: data.currency,
      phone: null,
      qrPayload: null,
      expiresAt: data.expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      showtime: this.showtimes.find((s) => s.id === data.showtimeId),
      bookingSeats: inv
        ? [
            {
              id: `bs-${data.ref}`,
              seatId: data.seatId,
              priceCents: data.seatPriceCents,
              seat: inv.seat,
            },
          ]
        : [],
    };
    this.bookings.set(data.ref, rec);
    return Promise.resolve(rec);
  }

  findBookingByRef(_db: any, ref: string): Promise<BookingRecord | null> {
    return Promise.resolve(this.bookings.get(ref) ?? null);
  }

  releaseHoldAtomically(_db: any, ref: string): Promise<boolean> {
    const b = this.bookings.get(ref);
    if (!b) return Promise.resolve(false);

    for (const bs of b.bookingSeats ?? []) {
      const inv = this.inventories.find((i) => i.showtimeId === b.showtimeId && i.seatId === bs.seatId);
      if (inv?.holdingBookingId === b.id) {
        inv.status = 'AVAILABLE';
        inv.heldUntil = null;
        inv.holdingBookingId = null;
      }
    }

    b.status = 'CANCELLED';
    return Promise.resolve(true);
  }
}

function fakeDb(): any {
  return {
    $transaction: (fn: (tx: any) => Promise<any>) => fn(fakeDb()),
  };
}

describe('CinemaService', () => {
  it('lists movies correctly', async () => {
    const repo = new InMemoryCinemaRepository();
    const service = new CinemaService({ db: fakeDb(), cinema: repo, logger: mockLogger, env: fakeEnv });

    const movies = await service.listMovies();
    expect(movies).toHaveLength(1);
    expect(movies[0]?.title).toBe('Dune: Part Two');
  });

  it('first hold succeeds', async () => {
    const repo = new InMemoryCinemaRepository();
    const service = new CinemaService({ db: fakeDb(), cinema: repo, logger: mockLogger, env: fakeEnv });

    const booking = await service.createBooking({ showtimeId: 'st-dune-1', seatId: 'seat-1' });
    expect(booking.status).toBe('HELD');
    expect(booking.amountCents).toBe(1500);
    expect(booking.ref).toMatch(/^CS-\d{4}-\d+/);
  });

  it('second hold on the same seat returns 409 SEAT_UNAVAILABLE', async () => {
    const repo = new InMemoryCinemaRepository();
    const service = new CinemaService({ db: fakeDb(), cinema: repo, logger: mockLogger, env: fakeEnv });

    await service.createBooking({ showtimeId: 'st-dune-1', seatId: 'seat-1' });
    await expect(service.createBooking({ showtimeId: 'st-dune-1', seatId: 'seat-1' })).rejects.toThrow(SeatUnavailableError);
  });

  it('early release makes the seat available again', async () => {
    const repo = new InMemoryCinemaRepository();
    const service = new CinemaService({ db: fakeDb(), cinema: repo, logger: mockLogger, env: fakeEnv });

    const b1 = await service.createBooking({ showtimeId: 'st-dune-1', seatId: 'seat-1' });
    await service.releaseHold(b1.ref);

    const b2 = await service.createBooking({ showtimeId: 'st-dune-1', seatId: 'seat-1' });
    expect(b2.status).toBe('HELD');
  });
});
