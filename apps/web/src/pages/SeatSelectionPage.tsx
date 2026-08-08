import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Info, Ticket, TriangleAlert } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cinemaApi, isSeatConflict } from "../api/cinema-api";
import { queryKeys } from "../api/query-keys";
import type { Seat } from "../api/types";
import { MAX_SEATS_PER_BOOKING } from "../api/types";
import { saveRecentBookingRef } from "../lib/storage";
import { formatDateTime, formatMoney, formatTime } from "../lib/format";
import { useDocumentVisible } from "../lib/hooks";
import { Badge, Button, Card, EmptyState, ErrorState, LiveIndicator, PageLoader, StepIndicator } from "../components/ui";
import { MobileBookingBar } from "../components/layout/MobileBookingBar";
import { SeatLegend, SeatMap } from "../features/seats/SeatMap";
import { removeConflictingSeats, toggleSeatSelection } from "../features/seats/selection";

function conflictIdsFrom(error: unknown, seats: Seat[]): string[] {
  if (error && typeof error === "object" && "details" in error) {
    const details = (error as { details?: unknown }).details;
    if (details && typeof details === "object") {
      const record = details as Record<string, unknown>;
      const value = record.conflictingSeatIds ?? record.conflicts ?? record.seatIds;
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    }
  }
  return seats.filter((seat) => seat.status !== "AVAILABLE").map((seat) => seat.id);
}

export default function SeatSelectionPage() {
  const { showtimeId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const visible = useDocumentVisible();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [conflictMessage, setConflictMessage] = useState("");
  const showtimeQuery = useQuery({ queryKey: queryKeys.showtime(showtimeId), queryFn: ({ signal }) => cinemaApi.getShowtime(showtimeId, signal), enabled: Boolean(showtimeId) });
  const seatsQuery = useQuery({
    queryKey: queryKeys.seats(showtimeId),
    queryFn: ({ signal }) => cinemaApi.getSeats(showtimeId, signal),
    enabled: Boolean(showtimeId),
    refetchInterval: visible ? 2_000 : false,
    refetchIntervalInBackground: false,
  });
  const holdMutation = useMutation({
    mutationFn: () => cinemaApi.createBooking({ showtimeId, seatIds: selectedIds }),
    onSuccess: (booking) => {
      saveRecentBookingRef(booking.ref);
      toast.success("Your seats are held", { description: "You have five minutes to verify and pay." });
      navigate(`/checkout/${encodeURIComponent(booking.ref)}`);
    },
    onError: async (error: unknown) => {
      if (isSeatConflict(error)) {
        let ids = conflictIdsFrom(error, []);
        const refreshed = await seatsQuery.refetch();
        if (ids.length === 0) ids = conflictIdsFrom(error, refreshed.data?.seats ?? []);
        setSelectedIds((current) => removeConflictingSeats(current, ids));
        setConflictMessage("Someone else just held a seat you selected. We refreshed the seat map.");
        toast.warning("Seat availability changed", { description: "We removed only the unavailable seats and kept the rest." });
        void queryClient.invalidateQueries({ queryKey: queryKeys.seats(showtimeId) });
        return;
      }
      const apiError = error as { message?: string; status?: number; requestId?: string };
      toast.error(apiError.status === 429 ? "Too many attempts" : "We couldn't hold those seats", { description: apiError.message ?? "Please try again." });
    },
  });
  const seats = useMemo(() => seatsQuery.data?.seats ?? [], [seatsQuery.data?.seats]);
  const selectedSeats = useMemo(() => seats.filter((seat) => selectedIds.includes(seat.id)), [seats, selectedIds]);
  const total = selectedSeats.reduce((sum, seat) => sum + seat.priceCents, 0);
  const currency = showtimeQuery.data?.currency ?? "USD";

  useEffect(() => {
    const unavailable = selectedIds.filter((id) => {
      const seat = seats.find((item) => item.id === id);
      return seat && seat.status !== "AVAILABLE";
    });
    if (unavailable.length > 0) {
      setSelectedIds((current) => removeConflictingSeats(current, unavailable));
      setConflictMessage("Seat availability changed. We kept your still-available selections.");
    }
  }, [seats, selectedIds]);

  if (showtimeQuery.isPending || seatsQuery.isPending) return <div className="shell page-section"><PageLoader label="Opening the room…" /></div>;
  if (showtimeQuery.isError || !showtimeQuery.data) return <div className="shell page-section"><ErrorState title="Showtime unavailable" message="This screening may have sold out or moved. Choose another showtime to continue." onRetry={() => void showtimeQuery.refetch()} /><Link className="button button--secondary" to="/"><ArrowLeft size={16} /> Back to discover</Link></div>;
  if (seatsQuery.isError) return <div className="shell page-section"><ErrorState title="Seat map unavailable" message="We couldn't get a live view of this room. Your booking has not started." onRetry={() => void seatsQuery.refetch()} /><Link className="button button--secondary" to={`/movies/${showtimeQuery.data.movieId}`}><ArrowLeft size={16} /> Choose another time</Link></div>;
  if (!seats.length) return <div className="shell page-section"><EmptyState icon={<Ticket size={20} />} title="No seats returned" message="This room is not accepting bookings right now." action={<Link className="button button--secondary" to={`/movies/${showtimeQuery.data.movieId}`}>Back to showtimes</Link>} /></div>;

  const toggleSeat = (seat: Seat) => {
    setConflictMessage("");
    const result = toggleSeatSelection(selectedIds, seat, MAX_SEATS_PER_BOOKING);
    if (result.limitReached) {
      toast.info(`You can choose up to ${MAX_SEATS_PER_BOOKING} seats per booking.`);
      return;
    }
    setSelectedIds(result.ids);
  };

  return <div className="seat-page shell page-section"><div className="seat-page__top"><Link className="back-link" to={`/movies/${showtimeQuery.data.movieId}`}><ArrowLeft size={15} /> Back to showtimes</Link><LiveIndicator label={visible ? "Live map" : "Paused in background"} /></div><div className="seat-summary-line"><div><span className="eyebrow">{showtimeQuery.data.theatreName} · {showtimeQuery.data.screenName ?? "Screen"}</span><h1>{formatTime(showtimeQuery.data.startsAt)} <span>·</span> {formatDateTime(showtimeQuery.data.startsAt, { hour: undefined, minute: undefined })}</h1></div><StepIndicator current={1} /></div><div className="seat-layout"><div className="seat-main"><div className="screen-stage"><div className="screen-glow" aria-hidden="true" /><div className="screen-line" /><span>SCREEN</span></div><div className="seat-map-scroll"><SeatMap seats={seats} selectedIds={selectedIds} onToggle={toggleSeat} disabled={holdMutation.isPending} /></div><SeatLegend /><div className="seat-note"><TriangleAlert size={15} /><span>Held and booked seats are locked. Seat prices may vary by row.</span></div>{conflictMessage ? <p className="sr-only" role="alert">{conflictMessage}</p> : null}</div><aside className="seat-aside"><Card className="seat-summary-card"><div className="summary-heading"><div><span className="eyebrow">{showtimeQuery.data.theatreName}</span><h2>Review your seats</h2></div><Badge tone="success">{seats.filter((seat) => seat.status === "AVAILABLE").length} open</Badge></div><div className="compact-showtime"><span>{formatDateTime(showtimeQuery.data.startsAt)}</span><strong>{showtimeQuery.data.screenName ?? "Standard screen"}</strong></div><div className="selected-chips">{selectedSeats.length ? selectedSeats.map((seat) => <button className="selected-chip" type="button" key={seat.id} onClick={() => toggleSeat(seat)}>{seat.label}<span aria-hidden="true">×</span></button>) : <p className="muted">No seats selected yet.</p>}</div><div className="price-lines"><div><span>Tickets</span><strong>{formatMoney(total, currency)}</strong></div><div className="price-total"><span>Total</span><strong>{formatMoney(total, currency)}</strong></div></div><Button size="lg" className="summary-continue" disabled={!selectedIds.length} loading={holdMutation.isPending} onClick={() => holdMutation.mutate()}>Continue to verify <span aria-hidden="true">→</span></Button><p className="summary-helper"><Info size={14} /> Holds are server-confirmed and time-limited.</p></Card></aside></div><MobileBookingBar><div><span className="mobile-booking-bar__count">{selectedIds.length ? `${selectedIds.length} selected` : "Choose seats"}</span><strong>{formatMoney(total, currency)}</strong></div><Button disabled={!selectedIds.length} loading={holdMutation.isPending} onClick={() => holdMutation.mutate()}>Continue</Button></MobileBookingBar></div>;
}
