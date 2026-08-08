import { request, jsonBody } from "./client";
import { asList, asRecord, readBoolean, readNumber, readString } from "./schemas";
import type {
  Booking,
  CinemaApi,
  CreateBookingInput,
  HealthStatus,
  Movie,
  OtpSendResult,
  OtpVerifyResult,
  PaymentResult,
  Seat,
  SeatMap,
  Showtime,
} from "./types";
import { ApiError } from "./types";
import { mockApi } from "../mocks/mock-api";

function unwrap(value: unknown): unknown {
  const record = asRecord(value);
  return record.data ?? record.result ?? value;
}

function toCents(record: Record<string, unknown>, centsKeys: string[], amountKeys: string[], fallback = 0): number {
  const cents = readNumber(record, centsKeys, Number.NaN);
  if (Number.isFinite(cents)) return Math.round(cents);
  const amount = readNumber(record, amountKeys, Number.NaN);
  return Number.isFinite(amount) ? Math.round(amount * 100) : fallback;
}

export function mapBookingStatus(value: unknown): Booking["status"] {
  const rawString = typeof value === "string" || typeof value === "number" ? String(value) : "DRAFT";
  const status = rawString.toUpperCase().replace(/[ -]/g, "_");
  const aliases: Record<string, Booking["status"]> = {
    CREATED: "DRAFT",
    PENDING: "PAYMENT_PENDING",
    PAYMENT_INITIATED: "PAYMENT_PENDING",
    PAID: "CONFIRMED",
    SUCCESS: "CONFIRMED",
    CANCELLED: "FAILED",
    CANCELED: "FAILED",
    HOLD_EXPIRED: "EXPIRED",
  };
  const known = [
    "DRAFT",
    "HELD",
    "AWAITING_PAYMENT",
    "PAYMENT_PENDING",
    "CONFIRMED",
    "FAILED",
    "EXPIRED",
    "REFUND_REQUIRED",
    "REFUNDED",
  ];
  return aliases[status] ?? (known.includes(status) ? (status as Booking["status"]) : "DRAFT");
}

export function mapSeatStatus(value: unknown): Seat["status"] {
  const rawString = typeof value === "string" || typeof value === "number" ? String(value) : "AVAILABLE";
  const status = rawString.toUpperCase().replace(/[ -]/g, "_");
  if (status === "HELD" || status === "HOLD" || status === "RESERVED") return "HELD";
  if (status === "PAYMENT_PENDING" || status === "PAYMENTPENDING") return "PAYMENT_PENDING";
  if (status === "BOOKED" || status === "SOLD" || status === "UNAVAILABLE") return "BOOKED";
  if (status === "SELECTED") return "SELECTED";
  return "AVAILABLE";
}

export function mapMovie(value: unknown): Movie {
  const record = asRecord(value);
  const genresValue = record.genres ?? record.genre;
  const genres = Array.isArray(genresValue)
    ? genresValue.filter((genre): genre is string => typeof genre === "string")
    : typeof genresValue === "string"
      ? genresValue.split(",").map((genre) => genre.trim()).filter(Boolean)
      : undefined;
  return {
    id: readString(record, ["id", "movieId", "movie_id"], crypto.randomUUID()),
    title: readString(record, ["title", "name"], "Untitled film"),
    synopsis: readString(record, ["synopsis", "description", "overview"]) || undefined,
    posterUrl: readString(record, ["posterUrl", "poster_url", "poster", "image"]) || undefined,
    backdropUrl: readString(record, ["backdropUrl", "backdrop_url", "backdrop", "heroImage"]) || undefined,
    durationMinutes: readNumber(record, ["durationMinutes", "duration_minutes", "duration"], 0) || undefined,
    certificate: readString(record, ["certificate", "rating", "ageRating"]) || undefined,
    genres,
  };
}

export function mapShowtime(value: unknown, movieIdFallback = ""): Showtime {
  const record = asRecord(value);
  const startsAt = readString(record, ["startsAt", "starts_at", "startTime", "start_time", "datetime"]);
  const availableSeats = readNumber(record, ["availableSeats", "available_seats", "remaining"], Number.NaN);
  const totalSeats = readNumber(record, ["totalSeats", "total_seats", "capacity"], Number.NaN);
  return {
    id: readString(record, ["id", "showtimeId", "showtime_id"], crypto.randomUUID()),
    movieId: readString(record, ["movieId", "movie_id"], movieIdFallback),
    startsAt: startsAt || new Date().toISOString(),
    theatreName: readString(record, ["theatreName", "theaterName", "theatre", "theater", "venue"], "CinemaSeat Hall"),
    screenName: readString(record, ["screenName", "screen_name", "screen"]) || undefined,
    priceCents: toCents(record, ["priceCents", "price_cents"], ["price", "amount"], 0),
    currency: readString(record, ["currency", "currencyCode", "currency_code"], "USD").toUpperCase(),
    availableSeats: Number.isFinite(availableSeats) ? availableSeats : undefined,
    totalSeats: Number.isFinite(totalSeats) ? totalSeats : undefined,
  };
}

export function mapSeat(value: unknown, index = 0): Seat {
  const record = asRecord(value);
  const rowLabel = readString(record, ["rowLabel", "row_label", "row"], String.fromCharCode(65 + Math.floor(index / 12)));
  const seatNumber = readNumber(record, ["seatNumber", "seat_number", "number", "column"], (index % 12) + 1);
  const label = readString(record, ["label", "name"], `${rowLabel}${seatNumber}`);
  return {
    id: readString(record, ["id", "seatId", "seat_id"], label),
    rowLabel,
    seatNumber,
    label,
    status: mapSeatStatus(record.status ?? record.state),
    priceCents: toCents(record, ["priceCents", "price_cents"], ["price", "amount"], 0),
    seatClass: readString(record, ["seatClass", "seat_class", "type", "category"]) || undefined,
  };
}

export function mapSeatMap(value: unknown, showtimeId: string): SeatMap {
  const payload = unwrap(value);
  const record = asRecord(payload);
  const rawSeats = asList(record.seats ?? payload);
  const seats = rawSeats.map((seat, index) => mapSeat(seat, index));
  const rows = [...new Set(seats.map((seat) => seat.rowLabel))].sort();
  const columns = Math.max(1, ...seats.map((seat) => seat.seatNumber));
  return {
    showtimeId,
    seats,
    rows,
    columns,
    updatedAt: readString(record, ["updatedAt", "updated_at"]) || undefined,
  };
}

export function mapBooking(value: unknown): Booking {
  const payload = unwrap(value);
  const record = asRecord(payload);
  const rawSeats = asList(record.seats ?? record.selectedSeats);
  const movieValue = record.movie;
  const showtimeValue = record.showtime;
  const movie = movieValue ? mapMovie(movieValue) : undefined;
  const showtime = showtimeValue ? mapShowtime(showtimeValue, movie?.id) : undefined;
  return {
    ref: readString(record, ["ref", "bookingRef", "booking_reference", "reference", "id"], "UNKNOWN"),
    status: mapBookingStatus(record.status ?? record.state),
    expiresAt: readString(record, ["expiresAt", "expires_at", "holdExpiresAt", "hold_expires_at"]) || undefined,
    amountCents: toCents(record, ["amountCents", "amount_cents", "totalCents", "total_cents"], ["amount", "total", "totalAmount"], 0),
    currency: readString(record, ["currency", "currencyCode", "currency_code"], showtime?.currency ?? "USD").toUpperCase(),
    movie,
    showtime,
    seats: rawSeats.map((seat, index) => mapSeat(seat, index)),
    qrPayload: readString(record, ["qrPayload", "qr_payload", "ticketToken", "ticket_token"]) || undefined,
    createdAt: readString(record, ["createdAt", "created_at"]) || undefined,
    message: readString(record, ["message", "reason"]) || undefined,
  };
}

function parseList<T>(mapper: (value: unknown, index?: number) => T) {
  return (body: unknown): T[] => asList(unwrap(body)).map((value, index) => mapper(value, index));
}

export class RealCinemaApi implements CinemaApi {
  async getHealth(signal?: AbortSignal): Promise<HealthStatus> {
    const started = performance.now();
    try {
      const data = await request<Record<string, unknown>>("health", { signal }, (body) => asRecord(body));
      const ok = data.status === "ok";
      return {
        ok,
        label: ok ? "Systems operational" : "System issue",
        latencyMs: Math.round(performance.now() - started),
      };
    } catch {
      return {
        ok: false,
        label: "API unreachable",
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }

  getMovies(signal?: AbortSignal): Promise<Movie[]> {
    return request("movies", { signal }, parseList((value) => mapMovie(value)));
  }

  async getMovie(movieId: string, signal?: AbortSignal): Promise<Movie> {
    return request(`movies/${encodeURIComponent(movieId)}`, { signal }, (body) => mapMovie(unwrap(body)));
  }

  getShowtimes(movieId?: string, signal?: AbortSignal): Promise<Showtime[]> {
    const query = movieId ? `?movieId=${encodeURIComponent(movieId)}` : "";
    return request(`showtimes${query}`, { signal, cache: "no-store" }, parseList((value) => mapShowtime(value, movieId)));
  }

  async getShowtime(showtimeId: string, signal?: AbortSignal): Promise<Showtime> {
    return request(`showtimes/${encodeURIComponent(showtimeId)}`, { signal, cache: "no-store" }, (body) => mapShowtime(unwrap(body)));
  }

  getSeats(showtimeId: string, signal?: AbortSignal): Promise<SeatMap> {
    return request(`showtimes/${encodeURIComponent(showtimeId)}/seats`, { signal, cache: "no-store" }, (body) => mapSeatMap(body, showtimeId));
  }

  createBooking(input: CreateBookingInput, signal?: AbortSignal): Promise<Booking> {
    return request("bookings", { method: "POST", body: jsonBody(input), signal }, mapBooking);
  }

  async cancelHold(bookingRef: string, signal?: AbortSignal): Promise<void> {
    await request<unknown>(`bookings/${encodeURIComponent(bookingRef)}/hold`, { method: "DELETE", signal });
  }

  sendOtp(bookingRef: string, phone: string, signal?: AbortSignal): Promise<OtpSendResult> {
    return request(`bookings/${encodeURIComponent(bookingRef)}/otp/send`, {
      method: "POST",
      body: jsonBody({ phone }),
      signal,
    }, (body) => {
      const record = asRecord(unwrap(body));
      return {
        accepted: readBoolean(record, ["accepted", "success", "sent"], true),
        retryAfterSeconds: readNumber(record, ["retryAfterSeconds", "retry_after", "resendIn"], 30),
        message: readString(record, ["message"]) || undefined,
      };
    });
  }

  verifyOtp(bookingRef: string, phone: string, code: string, signal?: AbortSignal): Promise<OtpVerifyResult> {
    return request(`bookings/${encodeURIComponent(bookingRef)}/otp/verify`, {
      method: "POST",
      body: jsonBody({ phone, code }),
      signal,
    }, (body) => {
      const record = asRecord(unwrap(body));
      return {
        verified: readBoolean(record, ["verified", "success", "valid"], false),
        message: readString(record, ["message", "error"]) || undefined,
      };
    });
  }

  pay(bookingRef: string, signal?: AbortSignal): Promise<PaymentResult> {
    return request(`bookings/${encodeURIComponent(bookingRef)}/pay`, {
      method: "POST",
      body: jsonBody({}),
      signal,
    }, (body) => {
      const record = asRecord(unwrap(body));
      return {
        status: mapBookingStatus(record.status ?? record.state ?? "PAYMENT_PENDING"),
        accepted: readBoolean(record, ["accepted", "success"], true),
        requestId: readString(record, ["requestId", "request_id"]) || undefined,
        message: readString(record, ["message"]) || undefined,
      };
    });
  }

  getBooking(bookingRef: string, signal?: AbortSignal): Promise<Booking> {
    return request(`bookings/${encodeURIComponent(bookingRef)}`, { signal, cache: "no-store" }, mapBooking);
  }
}

const realApi = new RealCinemaApi();
export const useMockMode = import.meta.env.VITE_USE_MOCKS === "true";
export const cinemaApi: CinemaApi = useMockMode ? mockApi : realApi;

/** Useful for deterministic component tests without changing production wiring. */
export function createApiForMode(mode: "mock" | "real"): CinemaApi {
  return mode === "mock" ? mockApi : realApi;
}

export function isSeatConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409;
}
