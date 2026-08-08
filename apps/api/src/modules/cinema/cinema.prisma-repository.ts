import type { DbClient } from '../../db/prisma.js';
import type {
  BookingRecord,
  CinemaRepository,
  CreateBookingData,
  HeldSeatResult,
  MovieRecord,
  SeatInventoryRecord,
  ShowtimeRecord,
} from './cinema.repository.js';

export class PrismaCinemaRepository implements CinemaRepository {
  async findMovies(db: DbClient): Promise<MovieRecord[]> {
    return db.movie.findMany({
      orderBy: { title: 'asc' },
    });
  }

  async findMovieById(db: DbClient, id: string): Promise<MovieRecord | null> {
    return db.movie.findUnique({
      where: { id },
    });
  }

  async findShowtimes(db: DbClient, movieId?: string): Promise<ShowtimeRecord[]> {
    return db.showtime.findMany({
      where: movieId ? { movieId } : undefined,
      include: {
        theatre: { select: { name: true } },
        screen: { select: { name: true, capacity: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async findShowtimeById(db: DbClient, id: string): Promise<ShowtimeRecord | null> {
    return db.showtime.findUnique({
      where: { id },
      include: {
        theatre: { select: { name: true } },
        screen: { select: { name: true, capacity: true } },
      },
    });
  }

  async findSeatMap(db: DbClient, showtimeId: string): Promise<SeatInventoryRecord[]> {
    return db.seatInventory.findMany({
      where: { showtimeId },
      include: {
        seat: {
          select: {
            id: true,
            rowLabel: true,
            seatNumber: true,
            seatClass: true,
            priceCents: true,
          },
        },
      },
      orderBy: [
        { seat: { rowLabel: 'asc' } },
        { seat: { seatNumber: 'asc' } },
      ],
    });
  }

  async countAvailableSeats(db: DbClient, showtimeId: string): Promise<number> {
    const now = new Date();
    return db.seatInventory.count({
      where: {
        showtimeId,
        OR: [
          { status: 'AVAILABLE' },
          { status: 'HELD', heldUntil: { lt: now } },
        ],
      },
    });
  }

  async countTotalSeats(db: DbClient, showtimeId: string): Promise<number> {
    return db.seatInventory.count({
      where: { showtimeId },
    });
  }

  async holdSeatAtomically(
    db: DbClient,
    showtimeId: string,
    seatId: string,
    heldUntil: Date,
    bookingId: string,
  ): Promise<HeldSeatResult | null> {
    const results = await db.$queryRaw<{ id: string; seatId: string; priceCents: number }[]>`
      UPDATE seat_inventories
      SET status = 'HELD',
          held_until = ${heldUntil},
          holding_booking_id = ${bookingId},
          version = version + 1,
          updated_at = NOW()
      WHERE showtime_id = ${showtimeId}
        AND seat_id = ${seatId}
        AND (status = 'AVAILABLE' OR (status = 'HELD' AND held_until IS NOT NULL AND held_until < NOW()))
      RETURNING id, seat_id as "seatId", price_cents as "priceCents"
    `;

    const first = results[0];
    if (!first) return null;
    return {
      inventoryId: first.id,
      seatId: first.seatId,
      priceCents: first.priceCents,
    };
  }

  async createBookingRecord(db: DbClient, data: CreateBookingData): Promise<BookingRecord> {
    return db.booking.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        ref: data.ref,
        showtimeId: data.showtimeId,
        status: data.status,
        amountCents: data.amountCents,
        currency: data.currency,
        expiresAt: data.expiresAt,
        bookingSeats: {
          create: [
            {
              seatId: data.seatId,
              priceCents: data.seatPriceCents,
            },
          ],
        },
      },
      include: {
        showtime: {
          include: {
            theatre: { select: { name: true } },
            screen: { select: { name: true, capacity: true } },
            movie: true,
          },
        },
        bookingSeats: {
          include: {
            seat: {
              select: {
                id: true,
                rowLabel: true,
                seatNumber: true,
                seatClass: true,
                priceCents: true,
              },
            },
          },
        },
      },
    });
  }

  async findBookingByRef(db: DbClient, ref: string): Promise<BookingRecord | null> {
    return db.booking.findUnique({
      where: { ref },
      include: {
        showtime: {
          include: {
            theatre: { select: { name: true } },
            screen: { select: { name: true, capacity: true } },
            movie: true,
          },
        },
        bookingSeats: {
          include: {
            seat: {
              select: {
                id: true,
                rowLabel: true,
                seatNumber: true,
                seatClass: true,
                priceCents: true,
              },
            },
          },
        },
      },
    });
  }

  async releaseHoldAtomically(db: DbClient, ref: string): Promise<boolean> {
    const booking = await db.booking.findUnique({
      where: { ref },
      include: { bookingSeats: true },
    });

    if (!booking) return false;

    if (booking.bookingSeats.length > 0) {
      const seatIds = booking.bookingSeats.map((bs) => bs.seatId);
      await db.seatInventory.updateMany({
        where: {
          showtimeId: booking.showtimeId,
          seatId: { in: seatIds },
          holdingBookingId: booking.id,
        },
        data: {
          status: 'AVAILABLE',
          heldUntil: null,
          holdingBookingId: null,
        },
      });
    }

    await db.booking.update({
      where: { ref },
      data: { status: 'CANCELLED' },
    });

    return true;
  }
}
