import type { DbClient } from '../../db/prisma.js';

export interface MovieRecord {
  id: string;
  title: string;
  synopsis: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  durationMinutes: number;
  certificate: string | null;
  genres: string[];
  createdAt: Date;
}

export interface ShowtimeRecord {
  id: string;
  movieId: string;
  theatreId: string;
  screenId: string;
  startsAt: Date;
  priceCents: number;
  currency: string;
  createdAt: Date;
  theatre?: { name: string } | null;
  screen?: { name: string; capacity: number } | null;
  movie?: MovieRecord | null;
}

export interface SeatInventoryRecord {
  id: string;
  showtimeId: string;
  seatId: string;
  status: string;
  priceCents: number;
  heldUntil: Date | null;
  holdingBookingId: string | null;
  updatedAt: Date;
  seat: {
    id: string;
    rowLabel: string;
    seatNumber: number;
    seatClass: string;
    priceCents: number;
  };
}

export interface BookingRecord {
  id: string;
  ref: string;
  showtimeId: string;
  status: string;
  amountCents: number;
  currency: string;
  phone: string | null;
  qrPayload: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  showtime?: ShowtimeRecord | null;
  bookingSeats?: {
    id: string;
    seatId: string;
    priceCents: number;
    seat: {
      id: string;
      rowLabel: string;
      seatNumber: number;
      seatClass: string;
      priceCents: number;
    };
  }[];
}

export interface HeldSeatResult {
  inventoryId: string;
  seatId: string;
  priceCents: number;
}

export interface CreateBookingData {
  id?: string;
  ref: string;
  showtimeId: string;
  status: string;
  amountCents: number;
  currency: string;
  expiresAt: Date;
  seats: {
    seatId: string;
    priceCents: number;
  }[];
}

export interface CinemaRepository {
  findMovies(db: DbClient): Promise<MovieRecord[]>;
  findMovieById(db: DbClient, id: string): Promise<MovieRecord | null>;
  findShowtimes(db: DbClient, movieId?: string): Promise<ShowtimeRecord[]>;
  findShowtimeById(db: DbClient, id: string): Promise<ShowtimeRecord | null>;
  findSeatMap(db: DbClient, showtimeId: string): Promise<SeatInventoryRecord[]>;
  countAvailableSeats(db: DbClient, showtimeId: string): Promise<number>;
  countTotalSeats(db: DbClient, showtimeId: string): Promise<number>;

  holdSeatAtomically(
    db: DbClient,
    showtimeId: string,
    seatId: string,
    heldUntil: Date,
    bookingId: string,
  ): Promise<HeldSeatResult | null>;

  createBookingRecord(db: DbClient, data: CreateBookingData): Promise<BookingRecord>;

  findBookingByRef(db: DbClient, ref: string): Promise<BookingRecord | null>;

  releaseHoldAtomically(db: DbClient, ref: string): Promise<boolean>;
}
