import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Booking, Movie, Seat } from "../api/types";
import { MAX_SEATS_PER_BOOKING } from "../api/types";
import { mapBookingStatus, mapMovie, mapSeatMap } from "../api/cinema-api";
import { MovieCard } from "../pages/DiscoverPage";
import { BookingStatusView } from "../pages/BookingPage";
import { SeatButton } from "../features/seats/SeatMap";
import { removeConflictingSeats, toggleSeatSelection } from "../features/seats/selection";
import { secondsUntil } from "../lib/hooks";
import { canStartPayment } from "../lib/booking";
import { mockApi } from "../mocks/mock-api";

const movie: Movie = { id: "m1", title: "Midnight Orbit", durationMinutes: 128, certificate: "PG-13", genres: ["Sci-fi"] };
const available: Seat = { id: "A1", rowLabel: "A", seatNumber: 1, label: "A1", status: "AVAILABLE", priceCents: 1200 };
const held: Seat = { ...available, id: "A2", label: "A2", seatNumber: 2, status: "HELD" };
const booked: Seat = { ...available, id: "A3", label: "A3", seatNumber: 3, status: "BOOKED" };
const baseBooking: Booking = {
  ref: "CS-2026-02401",
  status: "HELD",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  amountCents: 1200,
  currency: "USD",
  movie,
  showtime: { id: "s1", movieId: "m1", startsAt: "2026-08-08T18:00:00.000Z", theatreName: "Aurora Square", screenName: "IMAX 01", priceCents: 1200, currency: "USD" },
  seats: [available],
};

describe("CinemaSeat frontend contracts", () => {
  it("renders movie data returned by the adapter", () => {
    const apiMovie = mapMovie({ movie_id: "m1", name: "Midnight Orbit", duration_minutes: 128, rating: "PG-13" });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><MovieCard movie={apiMovie} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Midnight Orbit" })).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/movies/m1");
  });

  it("normalizes a backend seat list into the stable seat map", () => {
    const result = mapSeatMap({ seats: [{ seat_id: "B4", row: "B", number: 4, state: "sold", price_cents: 1500 }] }, "show-1");
    expect(result.seats[0]).toMatchObject({ id: "B4", label: "B4", status: "BOOKED", priceCents: 1500 });
  });

  it("toggles an available seat with an accessible button", () => {
    const onToggle = vi.fn();
    render(<SeatButton seat={available} selected={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /row a, seat 1, available/i }));
    expect(onToggle).toHaveBeenCalledWith(available);
  });

  it.each([held, booked])("does not allow unavailable seat $label to be selected", (seat) => {
    const onToggle = vi.fn();
    render(<SeatButton seat={seat} selected={false} onToggle={onToggle} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("marks a selected seat with aria-pressed", () => {
    render(<SeatButton seat={available} selected onToggle={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("enforces the maximum seat count", () => {
    const current = Array.from({ length: MAX_SEATS_PER_BOOKING }, (_, index) => `A${index + 1}`);
    const result = toggleSeatSelection(current, { ...available, id: "A7", label: "A7", seatNumber: 7 }, MAX_SEATS_PER_BOOKING);
    expect(result.limitReached).toBe(true);
    expect(result.ids).toEqual(current);
  });

  it("a 409 reconciliation removes only conflicting selections", () => {
    expect(removeConflictingSeats(["A1", "A2", "A3"], ["A2"])).toEqual(["A1", "A3"]);
  });

  it("calculates the hold countdown from the absolute expiry time", () => {
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    expect(secondsUntil("2026-08-08T12:01:01.000Z", now)).toBe(61);
    expect(secondsUntil("2026-08-08T11:59:59.000Z", now)).toBe(0);
  });

  it("disables payment when the server hold has expired", () => {
    expect(canStartPayment(baseBooking, true, true)).toBe(false);
    expect(canStartPayment(baseBooking, true, false)).toBe(true);
  });

  it("maps backend payment aliases to stable pending and confirmed states", () => {
    expect(mapBookingStatus("payment_initiated")).toBe("PAYMENT_PENDING");
    expect(mapBookingStatus("paid")).toBe("CONFIRMED");
  });

  it("shows a pending state after asynchronous payment starts", () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><BookingStatusView booking={{ ...baseBooking, status: "PAYMENT_PENDING" }} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /confirming your ticket/i })).toBeInTheDocument();
    expect(screen.getByText(/checking every 2 seconds/i)).toBeInTheDocument();
    expect(screen.queryByText(/you’re in/i)).not.toBeInTheDocument();
  });

  it("keeps an accepted payment pending until booking polling confirms it", async () => {
    vi.useFakeTimers();
    try {
      const clockStart = new Date("2026-08-08T12:00:00.000Z");
      vi.setSystemTime(clockStart);
      const showtimesPromise = mockApi.getShowtimes("dune-part-two");
      await vi.advanceTimersByTimeAsync(120);
      const [showtime] = await showtimesPromise;
      if (!showtime) throw new Error("Showtime not found");
      const seatsPromise = mockApi.getSeats(showtime.id);
      await vi.advanceTimersByTimeAsync(80);
      const seatMap = await seatsPromise;
      const seat = seatMap.seats.find((item) => item.status === "AVAILABLE")!;
      const holdPromise = mockApi.createBooking({ showtimeId: showtime.id, seatIds: [seat.id] });
      await vi.advanceTimersByTimeAsync(200);
      const booking = await holdPromise;
      const sendPromise = mockApi.sendOtp(booking.ref, "+1 555 014 2040");
      await vi.advanceTimersByTimeAsync(160);
      await sendPromise;
      const verifyPromise = mockApi.verifyOtp(booking.ref, "+1 555 014 2040", "123456");
      await vi.advanceTimersByTimeAsync(130);
      await verifyPromise;
      const payPromise = mockApi.pay(booking.ref);
      await vi.advanceTimersByTimeAsync(230);
      const accepted = await payPromise;
      expect(accepted).toMatchObject({ accepted: true, status: "PAYMENT_PENDING" });

      vi.setSystemTime(new Date(clockStart.getTime() + 5_000));
      const pollPromise = mockApi.getBooking(booking.ref);
      await vi.advanceTimersByTimeAsync(110);
      expect((await pollPromise).status).toBe("CONFIRMED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders confirmed ticket details and a real QR payload", () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><BookingStatusView booking={{ ...baseBooking, status: "CONFIRMED", qrPayload: "ticket:CS-2026-02401" }} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /you’re in/i })).toBeInTheDocument();
    expect(screen.getByText("Midnight Orbit")).toBeInTheDocument();
    expect(screen.getAllByText("CS-2026-02401").length).toBeGreaterThan(0);
    expect(screen.getByTitle(/ticket code/i)).toBeInTheDocument();
  });

  it("keeps status information visible in reduced-motion mode", () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><BookingStatusView booking={{ ...baseBooking, status: "FAILED" }} /></MemoryRouter>);
    expect(screen.getByText("Payment not completed")).toBeVisible();
    expect(screen.getByRole("heading", { name: /payment was not completed/i })).toBeVisible();
  });
});
