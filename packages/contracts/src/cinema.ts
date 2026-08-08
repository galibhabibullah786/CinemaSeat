import { z } from 'zod';

export const MovieSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  synopsis: z.string().optional(),
  posterUrl: z.string().optional(),
  backdropUrl: z.string().optional(),
  durationMinutes: z.number().int().min(1),
  certificate: z.string().optional(),
  genres: z.array(z.string()).optional(),
});
export type Movie = z.infer<typeof MovieSchema>;

export const ShowtimeSchema = z.object({
  id: z.string(),
  movieId: z.string(),
  startsAt: z.string().datetime(),
  theatreName: z.string(),
  screenName: z.string().optional(),
  priceCents: z.number().int().min(0),
  currency: z.string().default('USD'),
  availableSeats: z.number().int().optional(),
  totalSeats: z.number().int().optional(),
});
export type Showtime = z.infer<typeof ShowtimeSchema>;

export const SeatStatusSchema = z.enum([
  'AVAILABLE',
  'HELD',
  'PAYMENT_PENDING',
  'BOOKED',
  'SELECTED',
]);
export type SeatStatus = z.infer<typeof SeatStatusSchema>;

export const SeatSchema = z.object({
  id: z.string(),
  rowLabel: z.string(),
  seatNumber: z.number().int(),
  label: z.string(),
  status: SeatStatusSchema,
  priceCents: z.number().int().min(0),
  seatClass: z.string().optional(),
});
export type Seat = z.infer<typeof SeatSchema>;

export const SeatMapSchema = z.object({
  showtimeId: z.string(),
  seats: z.array(SeatSchema),
  rows: z.array(z.string()),
  columns: z.number().int(),
  updatedAt: z.string().optional(),
});
export type SeatMap = z.infer<typeof SeatMapSchema>;

export const MAX_SEATS_PER_BOOKING = 6;

export const GetShowtimesQuerySchema = z
  .object({
    movieId: z.string().optional(),
  })
  .strict();
export type GetShowtimesQuery = z.infer<typeof GetShowtimesQuerySchema>;

export const CreateBookingBodySchema = z
  .object({
    showtimeId: z.string().min(1, 'showtimeId is required'),
    seatId: z.string().min(1).optional(),
    seatIds: z.array(z.string().min(1)).min(1).max(MAX_SEATS_PER_BOOKING).optional(),
    userRef: z.string().optional(),
  })
  .strict()
  .superRefine((data, context) => {
    if (!data.seatId && !data.seatIds?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seatIds'],
        message: 'Either seatId or seatIds is required',
      });
    }
    if (data.seatId && data.seatIds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seatIds'],
        message: 'Use either seatId or seatIds, not both',
      });
    }
    if (data.seatIds && new Set(data.seatIds).size !== data.seatIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seatIds'],
        message: 'seatIds must not contain duplicates',
      });
    }
  })
  .transform(({ seatId, seatIds, ...input }) => ({
    ...input,
    seatIds: seatIds ?? [seatId!],
  }));
export type CreateBookingBody = z.input<typeof CreateBookingBodySchema>;
export type CreateBookingInput = z.output<typeof CreateBookingBodySchema>;

export const BookingStatusSchema = z.enum([
  'HELD',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingSchema = z.object({
  id: z.string().optional(),
  ref: z.string(),
  bookingRef: z.string().optional(),
  showtimeId: z.string().optional(),
  status: BookingStatusSchema,
  amountCents: z.number().int().min(0),
  currency: z.string().default('USD'),
  expiresAt: z.string().optional(),
  createdAt: z.string().optional(),
  seats: z.array(SeatSchema).optional(),
  movie: MovieSchema.optional(),
  showtime: ShowtimeSchema.optional(),
  qrPayload: z.string().optional(),
});
export type Booking = z.infer<typeof BookingSchema>;
