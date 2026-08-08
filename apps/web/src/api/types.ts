export const MAX_SEATS_PER_BOOKING = 6;

export type SeatStatus =
  | "AVAILABLE"
  | "HELD"
  | "PAYMENT_PENDING"
  | "BOOKED"
  | "SELECTED";

export type BookingStatus =
  | "DRAFT"
  | "HELD"
  | "AWAITING_PAYMENT"
  | "PAYMENT_PENDING"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "REFUND_REQUIRED"
  | "REFUNDED";

export interface Movie {
  id: string;
  title: string;
  synopsis?: string;
  posterUrl?: string;
  backdropUrl?: string;
  durationMinutes?: number;
  certificate?: string;
  genres?: string[];
}

export interface Showtime {
  id: string;
  movieId: string;
  startsAt: string;
  theatreName: string;
  screenName?: string;
  priceCents: number;
  currency: string;
  availableSeats?: number;
  totalSeats?: number;
}

export interface Seat {
  id: string;
  rowLabel: string;
  seatNumber: number;
  label: string;
  status: SeatStatus;
  priceCents: number;
  seatClass?: string;
}

export interface SeatMap {
  showtimeId: string;
  seats: Seat[];
  rows: string[];
  columns: number;
  updatedAt?: string;
}

export interface Booking {
  ref: string;
  status: BookingStatus;
  expiresAt?: string;
  amountCents: number;
  currency: string;
  movie?: Movie;
  showtime?: Showtime;
  seats: Seat[];
  qrPayload?: string;
  createdAt?: string;
  message?: string;
}

export interface CreateBookingInput {
  showtimeId: string;
  seatIds: string[];
}

export interface OtpSendResult {
  accepted: boolean;
  retryAfterSeconds?: number;
  message?: string;
}

export interface OtpVerifyResult {
  verified: boolean;
  message?: string;
}

export interface PaymentResult {
  status: BookingStatus;
  accepted: boolean;
  requestId?: string;
  message?: string;
}

export interface HealthStatus {
  ok: boolean;
  label: string;
  latencyMs?: number;
}

export interface ApiErrorOptions {
  status?: number;
  code?: string;
  requestId?: string;
  details?: unknown;
  retryable?: boolean;
}

/** A safe, user-facing error shape shared by real and mock adapters. */
export class ApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
    this.retryable = options.retryable ?? Boolean(options.status && options.status >= 500);
  }
}

export interface CinemaApi {
  getHealth(signal?: AbortSignal): Promise<HealthStatus>;
  getMovies(signal?: AbortSignal): Promise<Movie[]>;
  getMovie(movieId: string, signal?: AbortSignal): Promise<Movie>;
  getShowtimes(movieId?: string, signal?: AbortSignal): Promise<Showtime[]>;
  getShowtime(showtimeId: string, signal?: AbortSignal): Promise<Showtime>;
  getSeats(showtimeId: string, signal?: AbortSignal): Promise<SeatMap>;
  createBooking(input: CreateBookingInput, signal?: AbortSignal): Promise<Booking>;
  cancelHold(bookingRef: string, signal?: AbortSignal): Promise<void>;
  sendOtp(bookingRef: string, phone: string, signal?: AbortSignal): Promise<OtpSendResult>;
  verifyOtp(bookingRef: string, phone: string, code: string, signal?: AbortSignal): Promise<OtpVerifyResult>;
  pay(bookingRef: string, signal?: AbortSignal): Promise<PaymentResult>;
  getBooking(bookingRef: string, signal?: AbortSignal): Promise<Booking>;
}

export const TERMINAL_BOOKING_STATUSES: BookingStatus[] = [
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
];

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}
