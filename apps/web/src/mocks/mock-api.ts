import type {
  Booking,
  CinemaApi,
  CreateBookingInput,
  HealthStatus,
  OtpSendResult,
  OtpVerifyResult,
  PaymentResult,
  Seat,
  SeatMap,
  Showtime,
} from "../api/types";
import { ApiError } from "../api/types";
import { mockMovies, mockShowtimes, createMockSeats } from "./mock-data";

const seatStore = new Map<string, Seat[]>();
const bookingStore = new Map<string, Booking>();
const otpStore = new Map<string, { phone: string; verified: boolean; sentAt: number }>();
let refSequence = 2401;

for (const showtime of mockShowtimes) seatStore.set(showtime.id, createMockSeats(showtime));

const wait = (ms = 110) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const copySeats = (seats: Seat[]) => seats.map((seat) => ({ ...seat }));
const copyBooking = (booking: Booking): Booking => ({
  ...booking,
  movie: booking.movie ? { ...booking.movie, genres: booking.movie.genres ? [...booking.movie.genres] : undefined } : undefined,
  showtime: booking.showtime ? { ...booking.showtime } : undefined,
  seats: copySeats(booking.seats),
});

function getShowtimeOrThrow(showtimeId: string): Showtime {
  const showtime = mockShowtimes.find((item) => item.id === showtimeId);
  if (!showtime) throw new ApiError("That showtime is no longer available.", { status: 404 });
  return showtime;
}

function getBookingOrThrow(ref: string): Booking {
  const booking = bookingStore.get(ref);
  if (!booking) throw new ApiError("We could not find that booking reference.", { status: 404 });
  return booking;
}

function forceConflict(): boolean {
  try {
    return import.meta.env.VITE_MOCK_CONFLICT === "true" || sessionStorage.getItem("cinemaseat:mock-conflict") === "true";
  } catch {
    return import.meta.env.VITE_MOCK_CONFLICT === "true";
  }
}

function shouldFailPayment(): boolean {
  try {
    return import.meta.env.VITE_MOCK_PAYMENT_FAIL === "true" || sessionStorage.getItem("cinemaseat:mock-payment-fail") === "true";
  } catch {
    return import.meta.env.VITE_MOCK_PAYMENT_FAIL === "true";
  }
}

function refreshBookingStatus(booking: Booking): void {
  if (booking.status === "HELD" && booking.expiresAt && Date.parse(booking.expiresAt) <= Date.now()) {
    booking.status = "EXPIRED";
    const seats = seatStore.get(booking.showtime?.id ?? "") ?? [];
    for (const heldSeat of booking.seats) {
      const current = seats.find((seat) => seat.id === heldSeat.id);
      if (current?.status === "HELD") current.status = "AVAILABLE";
    }
  }
  if (booking.status === "PAYMENT_PENDING" && booking.createdAt && Date.parse(booking.createdAt) + 3_200 <= Date.now()) {
    if (shouldFailPayment()) {
      booking.status = "FAILED";
      booking.message = "Payment was not completed. No booking was confirmed.";
      return;
    }
    booking.status = "CONFIRMED";
    booking.expiresAt = undefined;
    booking.qrPayload = `cinemaseat:${booking.ref}`;
    const seats = seatStore.get(booking.showtime?.id ?? "") ?? [];
    for (const heldSeat of booking.seats) {
      const current = seats.find((seat) => seat.id === heldSeat.id);
      if (current) current.status = "BOOKED";
    }
  }
}

export const mockApi: CinemaApi = {
  async getHealth(): Promise<HealthStatus> {
    await wait(80);
    return { ok: true, label: "Demo systems operational", latencyMs: 42 };
  },

  async getMovies() {
    await wait();
    return mockMovies.map((movie) => ({ ...movie, genres: movie.genres ? [...movie.genres] : undefined }));
  },

  async getMovie(movieId: string) {
    await wait();
    const movie = mockMovies.find((item) => item.id === movieId);
    if (!movie) throw new ApiError("We could not find that movie.", { status: 404 });
    return { ...movie, genres: movie.genres ? [...movie.genres] : undefined };
  },

  async getShowtimes(movieId?: string) {
    await wait();
    return mockShowtimes.filter((showtime) => !movieId || showtime.movieId === movieId).map((showtime) => ({ ...showtime }));
  },

  async getShowtime(showtimeId: string) {
    await wait();
    return { ...getShowtimeOrThrow(showtimeId) };
  },

  async getSeats(showtimeId: string): Promise<SeatMap> {
    await wait(75);
    getShowtimeOrThrow(showtimeId);
    const seats = copySeats(seatStore.get(showtimeId) ?? []);
    return {
      showtimeId,
      seats,
      rows: [...new Set(seats.map((seat) => seat.rowLabel))],
      columns: 12,
      updatedAt: new Date().toISOString(),
    };
  },

  async createBooking(input: CreateBookingInput) {
    await wait(180);
    const showtime = getShowtimeOrThrow(input.showtimeId);
    const seats = seatStore.get(input.showtimeId) ?? [];
    const conflictingIds = seats.filter((seat) => input.seatIds.includes(seat.id) && seat.status !== "AVAILABLE").map((seat) => seat.id);
    if (forceConflict() || conflictingIds.length > 0) {
      const ids = conflictingIds.length > 0 ? conflictingIds : input.seatIds.slice(0, 1);
      throw new ApiError("Someone else just held a seat you selected. We refreshed the seat map.", {
        status: 409,
        code: "SEAT_CONFLICT",
        details: { conflictingSeatIds: ids },
      });
    }
    if (input.seatIds.length === 0) throw new ApiError("Choose at least one seat to continue.", { status: 422 });
    const selected = seats.filter((seat) => input.seatIds.includes(seat.id)).map((seat) => ({ ...seat, status: "HELD" as const }));
    for (const seat of seats) if (input.seatIds.includes(seat.id)) seat.status = "HELD";
    const ref = `CS-${new Date().getFullYear()}-${String(refSequence++).padStart(5, "0")}`;
    const booking: Booking = {
      ref,
      status: "HELD",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      amountCents: selected.reduce((sum, seat) => sum + seat.priceCents, 0),
      currency: showtime.currency,
      movie: mockMovies.find((movie) => movie.id === showtime.movieId),
      showtime: { ...showtime },
      seats: selected,
      createdAt: new Date().toISOString(),
    };
    bookingStore.set(ref, booking);
    return copyBooking(booking);
  },

  async cancelHold(bookingRef: string) {
    await wait(80);
    const booking = getBookingOrThrow(bookingRef);
    refreshBookingStatus(booking);
    if (booking.status === "HELD") {
      booking.status = "EXPIRED";
      const seats = seatStore.get(booking.showtime?.id ?? "") ?? [];
      for (const bookingSeat of booking.seats) {
        const current = seats.find((seat) => seat.id === bookingSeat.id);
        if (current?.status === "HELD") current.status = "AVAILABLE";
      }
    }
  },

  async sendOtp(bookingRef: string, phone: string): Promise<OtpSendResult> {
    await wait(150);
    const booking = getBookingOrThrow(bookingRef);
    refreshBookingStatus(booking);
    if (booking.status !== "HELD") throw new ApiError("This hold is no longer active.", { status: 409 });
    if (phone.replace(/\D/g, "").length < 7) throw new ApiError("Enter a valid phone number.", { status: 422 });
    otpStore.set(bookingRef, { phone, verified: false, sentAt: Date.now() });
    return { accepted: true, retryAfterSeconds: 30, message: "Code sent. Delivery can take a moment." };
  },

  async verifyOtp(bookingRef: string, phone: string, code: string): Promise<OtpVerifyResult> {
    await wait(120);
    const booking = getBookingOrThrow(bookingRef);
    refreshBookingStatus(booking);
    const otp = otpStore.get(bookingRef);
    if (booking.status !== "HELD") throw new ApiError("This hold is no longer active.", { status: 409 });
    if (!otp?.phone || otp.phone !== phone) throw new ApiError("Send a new code before verifying.", { status: 422 });
    if (code !== "123456") throw new ApiError("That code did not match. Please try again.", { status: 422 });
    otp.verified = true;
    return { verified: true, message: "Phone verified." };
  },

  async pay(bookingRef: string): Promise<PaymentResult> {
    await wait(220);
    const booking = getBookingOrThrow(bookingRef);
    refreshBookingStatus(booking);
    const otp = otpStore.get(bookingRef);
    if (booking.status !== "HELD") throw new ApiError("Your seat hold is no longer active.", { status: 409 });
    if (!otp?.verified) throw new ApiError("Verify your phone before paying.", { status: 422 });
    booking.status = "PAYMENT_PENDING";
    booking.createdAt = new Date().toISOString();
    return { status: "PAYMENT_PENDING", accepted: true, message: "Payment started." };
  },

  async getBooking(bookingRef: string) {
    await wait(100);
    const booking = getBookingOrThrow(bookingRef);
    refreshBookingStatus(booking);
    return copyBooking(booking);
  },
};
