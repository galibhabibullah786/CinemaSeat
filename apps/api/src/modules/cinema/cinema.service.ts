import { randomUUID } from 'node:crypto';

import type { Booking, BookingStatus, CreateBookingInput, Movie, Seat, SeatMap, SeatStatus, Showtime } from '@baseplate/contracts';
import type { Logger } from '@baseplate/logger';

import type { Db } from '../../db/prisma.js';
import { NotFoundError, SeatUnavailableError } from '../../domain/errors.js';
import type { BookingRecord, CinemaRepository, MovieRecord, ShowtimeRecord } from './cinema.repository.js';

export interface CinemaServiceDeps {
  db: Db;
  cinema: CinemaRepository;
  logger: Logger;
  env: {
    HOLD_TTL_SECONDS: number;
  };
}

export class CinemaService {
  constructor(private readonly deps: CinemaServiceDeps) {}

  async listMovies(): Promise<Movie[]> {
    const records = await this.deps.cinema.findMovies(this.deps.db);
    return records.map(toMovieDto);
  }

  async getMovieById(id: string): Promise<Movie> {
    const record = await this.deps.cinema.findMovieById(this.deps.db, id);
    if (!record) throw new NotFoundError('Movie', id);
    return toMovieDto(record);
  }

  async listShowtimes(movieId?: string): Promise<Showtime[]> {
    if (movieId) {
      const movie = await this.deps.cinema.findMovieById(this.deps.db, movieId);
      if (!movie) throw new NotFoundError('Movie', movieId);
    }

    const records = await this.deps.cinema.findShowtimes(this.deps.db, movieId);

    const showtimes = await Promise.all(
      records.map(async (record) => {
        const availableSeats = await this.deps.cinema.countAvailableSeats(this.deps.db, record.id);
        const totalSeats = await this.deps.cinema.countTotalSeats(this.deps.db, record.id);
        return toShowtimeDto(record, availableSeats, totalSeats);
      }),
    );

    return showtimes;
  }

  async getShowtimeById(id: string): Promise<Showtime> {
    const record = await this.deps.cinema.findShowtimeById(this.deps.db, id);
    if (!record) throw new NotFoundError('Showtime', id);
    const availableSeats = await this.deps.cinema.countAvailableSeats(this.deps.db, id);
    const totalSeats = await this.deps.cinema.countTotalSeats(this.deps.db, id);
    return toShowtimeDto(record, availableSeats, totalSeats);
  }

  async getSeatMap(showtimeId: string): Promise<SeatMap> {
    const showtime = await this.deps.cinema.findShowtimeById(this.deps.db, showtimeId);
    if (!showtime) throw new NotFoundError('Showtime', showtimeId);

    const inventories = await this.deps.cinema.findSeatMap(this.deps.db, showtimeId);
    const now = new Date();

    const seats: Seat[] = inventories.map((inv) => {
      let status: SeatStatus = (inv.status as SeatStatus) ?? 'AVAILABLE';
      if (status === 'HELD' && inv.heldUntil && inv.heldUntil < now) {
        status = 'AVAILABLE';
      }
      return {
        id: inv.seat.id,
        rowLabel: inv.seat.rowLabel,
        seatNumber: inv.seat.seatNumber,
        label: `${inv.seat.rowLabel}${inv.seat.seatNumber}`,
        status,
        priceCents: inv.priceCents,
        seatClass: inv.seat.seatClass,
      };
    });

    const rows = [...new Set(seats.map((s) => s.rowLabel))].sort();
    const columns = seats.length > 0 ? Math.max(...seats.map((s) => s.seatNumber)) : 0;
    const latestUpdated = inventories.reduce<Date | null>((latest, inv) => {
      if (!latest || inv.updatedAt > latest) return inv.updatedAt;
      return latest;
    }, null);

    return {
      showtimeId,
      seats,
      rows,
      columns,
      updatedAt: latestUpdated?.toISOString(),
    };
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const { showtimeId, seatIds } = input;

    const showtime = await this.deps.cinema.findShowtimeById(this.deps.db, showtimeId);
    if (!showtime) throw new NotFoundError('Showtime', showtimeId);

    const ttlSeconds = this.deps.env.HOLD_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const bookingRecord = await this.deps.db.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const randomRefNum = Math.floor(10000 + Math.random() * 90000);
      const ref = `CS-${year}-${randomRefNum}`;
      const bookingId = randomUUID();

      const heldSeats = [];
      for (const seatId of seatIds) {
        const held = await this.deps.cinema.holdSeatAtomically(
          tx,
          showtimeId,
          seatId,
          expiresAt,
          bookingId,
        );
        if (!held) {
          throw new SeatUnavailableError(`Seat ${seatId} is unavailable for showtime ${showtimeId}`);
        }
        heldSeats.push(held);
      }

      return this.deps.cinema.createBookingRecord(tx, {
        id: bookingId,
        ref,
        showtimeId,
        status: 'HELD',
        amountCents: heldSeats.reduce((total, seat) => total + seat.priceCents, 0),
        currency: showtime.currency ?? 'USD',
        expiresAt,
        seats: heldSeats.map((seat) => ({ seatId: seat.seatId, priceCents: seat.priceCents })),
      });
    });

    return toBookingDto(bookingRecord);
  }

  async getBookingByRef(ref: string): Promise<Booking> {
    const record = await this.deps.cinema.findBookingByRef(this.deps.db, ref);
    if (!record) throw new NotFoundError('Booking', ref);

    const isExpired = record.status === 'HELD' && record.expiresAt && record.expiresAt < new Date();
    const effectiveStatus = isExpired ? 'EXPIRED' : (record.status as BookingStatus);

    return toBookingDto(record, effectiveStatus);
  }

  async releaseHold(ref: string): Promise<void> {
    const released = await this.deps.db.$transaction((tx) =>
      this.deps.cinema.releaseHoldAtomically(tx, ref),
    );
    if (!released) throw new NotFoundError('Booking', ref);
  }
}

function toMovieDto(record: MovieRecord): Movie {
  return {
    id: record.id,
    title: record.title,
    synopsis: record.synopsis ?? undefined,
    posterUrl: record.posterUrl ?? undefined,
    backdropUrl: record.backdropUrl ?? undefined,
    durationMinutes: record.durationMinutes,
    certificate: record.certificate ?? undefined,
    genres: record.genres,
  };
}

function toShowtimeDto(record: ShowtimeRecord, availableSeats?: number, totalSeats?: number): Showtime {
  return {
    id: record.id,
    movieId: record.movieId,
    startsAt: record.startsAt.toISOString(),
    theatreName: record.theatre?.name ?? 'CinemaSeat Hall',
    screenName: record.screen?.name ?? undefined,
    priceCents: record.priceCents,
    currency: record.currency,
    availableSeats,
    totalSeats,
  };
}

function toBookingDto(record: BookingRecord, overrideStatus?: BookingStatus): Booking {
  const status = overrideStatus ?? (record.status as BookingStatus);

  const seats: Seat[] = (record.bookingSeats ?? []).map((bs) => ({
    id: bs.seat.id,
    rowLabel: bs.seat.rowLabel,
    seatNumber: bs.seat.seatNumber,
    label: `${bs.seat.rowLabel}${bs.seat.seatNumber}`,
    status: status === 'HELD' ? 'HELD' : 'BOOKED',
    priceCents: bs.priceCents,
    seatClass: bs.seat.seatClass,
  }));

  const showtime = record.showtime
    ? {
        id: record.showtime.id,
        movieId: record.showtime.movieId,
        startsAt: record.showtime.startsAt.toISOString(),
        theatreName: record.showtime.theatre?.name ?? 'CinemaSeat Hall',
        screenName: record.showtime.screen?.name ?? undefined,
        priceCents: record.showtime.priceCents,
        currency: record.showtime.currency,
      }
    : undefined;

  const movie = record.showtime?.movie
    ? {
        id: record.showtime.movie.id,
        title: record.showtime.movie.title,
        synopsis: record.showtime.movie.synopsis ?? undefined,
        posterUrl: record.showtime.movie.posterUrl ?? undefined,
        backdropUrl: record.showtime.movie.backdropUrl ?? undefined,
        durationMinutes: record.showtime.movie.durationMinutes,
        certificate: record.showtime.movie.certificate ?? undefined,
        genres: record.showtime.movie.genres,
      }
    : undefined;

  return {
    id: record.id,
    ref: record.ref,
    bookingRef: record.ref,
    showtimeId: record.showtimeId,
    status,
    amountCents: record.amountCents,
    currency: record.currency,
    expiresAt: record.expiresAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    seats,
    showtime,
    movie,
    qrPayload: record.qrPayload ?? undefined,
  };
}
