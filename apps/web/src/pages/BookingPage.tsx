import { useEffect, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleX, Clock3, Copy, HelpCircle, Printer, RefreshCw, RotateCcw, ShieldCheck, TicketCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { cinemaApi } from "../api/cinema-api";
import { queryKeys } from "../api/query-keys";
import type { Booking, BookingStatus } from "../api/types";
import { isTerminalBookingStatus } from "../api/types";
import { useDocumentVisible } from "../lib/hooks";
import { formatDateTime, formatMoney } from "../lib/format";
import { Button, Card, ErrorState, LiveIndicator, PageLoader, StatusPill } from "../components/ui";

export function BookingStatusView({ booking, longWait = false }: { booking: Booking; longWait?: boolean }) {
  if (booking.status === "CONFIRMED") return <ConfirmedTicket booking={booking} />;
  if (booking.status === "PAYMENT_PENDING" || booking.status === "AWAITING_PAYMENT") {
    return <Card className="pending-panel"><div className="pending-orbit" aria-hidden="true"><span /><TicketCheck size={28} /></div><StatusPill status={booking.status} /><h1>We’re confirming your ticket.</h1><p>{booking.status === "PAYMENT_PENDING" ? "Payment started. We’re waiting for confirmation—keep this page open." : "The payment gateway is ready when you are."}</p>{longWait ? <div className="pending-note"><Clock3 size={16} /><span><strong>Still checking</strong>This is taking longer than usual, but it does not mean payment failed.</span></div> : null}<LiveIndicator label="Checking every 2 seconds" /><div className="booking-ref booking-ref--center"><span>Booking reference</span><code>{booking.ref}</code></div></Card>;
  }
  if (booking.status === "FAILED" || booking.status === "EXPIRED") {
    const expired = booking.status === "EXPIRED";
    return <Card className="result-panel result-panel--failed"><span className="result-icon"><CircleX size={28} /></span><StatusPill status={booking.status} /><h1>{expired ? "Your seat hold expired." : "Payment was not completed."}</h1><p>{booking.message ?? (expired ? "The hold ended before payment was completed. Choose seats again to start a fresh timer." : "No booking was confirmed. You can safely choose seats again.")}</p><div className="result-actions">{booking.showtime ? <Link className="button button--primary" to={`/showtimes/${booking.showtime.id}/seats`}><RotateCcw size={16} /> Choose seats again</Link> : <Link className="button button--primary" to="/">Browse movies</Link>}<Link className="button button--secondary" to="/lookup">Find another booking</Link></div></Card>;
  }
  if (booking.status === "REFUND_REQUIRED" || booking.status === "REFUNDED") {
    return <Card className="result-panel"><span className="result-icon"><RefreshCw size={28} /></span><StatusPill status={booking.status} /><h1>{booking.status === "REFUNDED" ? "Your refund is complete." : "A refund is being arranged."}</h1><p>{booking.message ?? "Keep this booking reference handy. The latest status will remain available here."}</p><div className="booking-ref booking-ref--center"><span>Booking reference</span><code>{booking.ref}</code></div><Link className="button button--secondary" to="/">Back to discover</Link></Card>;
  }
  return <Card className="result-panel"><span className="result-icon"><HelpCircle size={28} /></span><StatusPill status={booking.status} /><h1>Your booking is waiting.</h1><p>Return to checkout to finish verification and payment before the hold expires.</p><Link className="button button--primary" to={`/checkout/${encodeURIComponent(booking.ref)}`}>Continue checkout</Link></Card>;
}

function ConfirmedTicket({ booking }: { booking: Booking }) {
  const [copied, setCopied] = useState(false);
  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(booking.ref);
      setCopied(true);
      toast.success("Booking reference copied");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Copy failed", { description: `Your reference is ${booking.ref}` });
    }
  };
  const qrValue = booking.qrPayload ?? booking.ref;
  return <div className="confirmed-wrap"><div className="success-heading"><span className="success-icon"><Check size={25} strokeWidth={3} /></span><StatusPill status="CONFIRMED" /><h1>You’re in. Your seats are confirmed.</h1><p>Everything you need for the big screen is right here.</p></div><Card className="digital-ticket"><div className="ticket-accent" /><div className="digital-ticket__main"><div className="digital-ticket__brand"><span>CINEMA<span>SEAT</span></span><small>ADMIT {Math.max(1, booking.seats.length)}</small></div><div className="digital-ticket__title"><span className="eyebrow">Now admitting</span><h2>{booking.movie?.title ?? "CinemaSeat screening"}</h2><p>{booking.movie?.certificate ? `${booking.movie.certificate} · ` : ""}{booking.movie?.genres?.join(" · ")}</p></div><div className="ticket-details"><div><span>Date & time</span><strong>{formatDateTime(booking.showtime?.startsAt)}</strong></div><div><span>Cinema</span><strong>{booking.showtime?.theatreName ?? "CinemaSeat"}</strong></div><div><span>Screen</span><strong>{booking.showtime?.screenName ?? "Main screen"}</strong></div><div><span>Seats</span><strong>{booking.seats.map((seat) => seat.label).join(", ") || "Assigned at entry"}</strong></div></div><div className="ticket-total"><span>Total paid</span><strong>{formatMoney(booking.amountCents, booking.currency)}</strong></div></div><div className="ticket-tear" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /></div><div className="digital-ticket__stub"><QRCodeSVG value={qrValue} size={136} bgColor="#f7f8fb" fgColor="#0a0d13" level="M" marginSize={1} title={`Ticket code for booking ${booking.ref}`} /><div className="booking-ref"><span>Booking reference</span><code>{booking.ref}</code></div><p>Show this code at entry</p></div></Card><div className="ticket-actions"><Button variant="secondary" onClick={() => void copyReference()}>{copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy reference"}</Button><Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print ticket</Button><Link className="button button--primary" to="/">Find another film</Link></div><p className="ticket-assurance"><ShieldCheck size={15} /> Your seat is confirmed in the booking system—not just on this screen.</p></div>;
}

export default function BookingPage() {
  const { bookingRef = "" } = useParams();
  const visible = useDocumentVisible();
  const [pendingSince, setPendingSince] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const bookingQuery = useQuery({
    queryKey: queryKeys.booking(bookingRef),
    queryFn: ({ signal }) => cinemaApi.getBooking(bookingRef, signal),
    enabled: Boolean(bookingRef),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !isTerminalBookingStatus(status) && visible ? 2_000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const status: BookingStatus | undefined = bookingQuery.data?.status;
  useEffect(() => {
    if (status === "PAYMENT_PENDING" && pendingSince === undefined) setPendingSince(Date.now());
  }, [pendingSince, status]);
  useEffect(() => {
    if (pendingSince === undefined) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pendingSince]);

  if (bookingQuery.isPending) return <div className="shell page-section"><PageLoader label="Checking your booking…" /></div>;
  if (bookingQuery.isError || !bookingQuery.data) return <div className="shell page-section"><ErrorState title="Booking not found" message="Check the reference and try again. References look like CS-2026-02401." onRetry={() => void bookingQuery.refetch()} /><Link className="button button--secondary" to="/lookup"><ArrowLeft size={16} /> Booking lookup</Link></div>;
  const longWait = pendingSince !== undefined && now - pendingSince > 30_000;
  return <div className="booking-page shell page-section"><BookingStatusView booking={bookingQuery.data} longWait={longWait} /></div>;
}
