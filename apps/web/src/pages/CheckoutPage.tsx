import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Info, LockKeyhole, Phone, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cinemaApi } from "../api/cinema-api";
import { queryKeys } from "../api/query-keys";
import type { ApiError } from "../api/types";
import { useCountdown, useDocumentVisible } from "../lib/hooks";
import { formatDateTime, formatMoney } from "../lib/format";
import { canStartPayment } from "../lib/booking";
import { Button, Card, Countdown, ErrorState, PageLoader, StatusPill, StepIndicator } from "../components/ui";

function OtpInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");
  const setDigit = (index: number, next: string) => {
    const clean = next.replace(/\D/g, "").slice(-1);
    const nextDigits = [...digits];
    nextDigits[index] = clean;
    onChange(nextDigits.join(""));
    if (clean && index < 5) refs.current[index + 1]?.focus();
  };
  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };
  return <div className="otp-inputs" aria-label="Six digit verification code">{digits.map((digit, index) => <input key={index} ref={(element) => { refs.current[index] = element; }} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} aria-label={`Verification digit ${index + 1}`} value={digit} disabled={disabled} maxLength={1} onChange={(event) => setDigit(index, event.target.value)} onKeyDown={(event) => handleKeyDown(index, event)} onPaste={handlePaste} />)}</div>;
}

function HoldProgress({ seconds, progress, expired }: { seconds: number; progress: number; expired: boolean }) {
  return <div className="hold-progress"><div className="hold-progress__head"><span><Clock3 size={15} /> {expired ? "Hold expired" : "Seats held for you"}</span>{expired ? <strong>00:00</strong> : <Countdown seconds={seconds} />}</div><div className="progress-track"><span style={{ transform: `scaleX(${progress})` }} /></div><p>{expired ? "Choose seats again to start a new hold." : "The server timer is authoritative. We’ll pause payment when it reaches zero."}</p></div>;
}

export default function CheckoutPage() {
  const { bookingRef = "" } = useParams();
  const navigate = useNavigate();
  const visible = useDocumentVisible();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [resendUntil, setResendUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [statusMessage, setStatusMessage] = useState("");
  const [gatewayUnavailable, setGatewayUnavailable] = useState(false);
  const bookingQuery = useQuery({
    queryKey: queryKeys.booking(bookingRef),
    queryFn: ({ signal }) => cinemaApi.getBooking(bookingRef, signal),
    enabled: Boolean(bookingRef),
    refetchInterval: (query) => query.state.data?.status === "HELD" && visible ? 2_000 : false,
    refetchIntervalInBackground: false,
  });
  const booking = bookingQuery.data;
  const countdown = useCountdown(booking?.expiresAt);
  const otpSend = useMutation({
    mutationFn: () => cinemaApi.sendOtp(bookingRef, phone),
    onSuccess: (result) => {
      setResendUntil(Date.now() + (result.retryAfterSeconds ?? 30) * 1_000);
      setStatusMessage(result.message ?? "Code sent. Delivery can take a moment.");
      toast.success("Verification code sent");
    },
    onError: (error: unknown) => toast.error("We couldn't send that code", { description: (error as ApiError).message }),
  });
  const otpVerify = useMutation({
    mutationFn: () => cinemaApi.verifyOtp(bookingRef, phone, otp),
    onSuccess: (result) => { if (result.verified) { setStatusMessage("Phone verified. You can start payment."); toast.success("Phone verified"); } },
    onError: (error: unknown) => toast.error("Code not accepted", { description: (error as ApiError).message }),
  });
  const payMutation = useMutation({
    mutationFn: () => cinemaApi.pay(bookingRef),
    onSuccess: (result) => {
      setGatewayUnavailable(false);
      if (result.status === "PAYMENT_PENDING" || result.accepted) {
        toast.success("Payment started", { description: "We’re waiting for the cinema to confirm it." });
        navigate(`/booking/${encodeURIComponent(bookingRef)}`);
      }
    },
    onError: (error: unknown) => {
      const apiError = error as ApiError;
      if (apiError.status === 503) setGatewayUnavailable(true);
      else toast.error("Payment could not start", { description: apiError.message });
    },
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const resendSeconds = Math.max(0, Math.ceil((resendUntil - now) / 1_000));
  const otpVerified = otpVerify.data?.verified === true;
  const phoneValid = phone.replace(/\D/g, "").length >= 7;
  const paymentDisabled = !canStartPayment(booking, otpVerified, countdown.expired) || payMutation.isPending;

  if (bookingQuery.isPending) return <div className="shell page-section"><PageLoader label="Retrieving your hold…" /></div>;
  if (bookingQuery.isError || !booking) return <div className="shell page-section"><ErrorState title="Booking hold not found" message="This reference may be incorrect or may have expired." onRetry={() => void bookingQuery.refetch()} /><Link className="button button--secondary" to="/lookup"><ArrowLeft size={16} /> Look up another booking</Link></div>;

  if (booking.status !== "HELD" && booking.status !== "AWAITING_PAYMENT") return <div className="shell page-section"><Card className="center-state"><StatusPill status={booking.status} /><h1>This booking is no longer at checkout</h1><p>We’ll show the latest result on your booking page.</p><Link className="button button--primary" to={`/booking/${encodeURIComponent(bookingRef)}`}>View booking status</Link></Card></div>;

  const expiryText = countdown.expired ? "Your seat hold expired before payment was completed." : "Your seats are safely held while you verify.";
  return <div className="shell page-section checkout-page"><div className="checkout-top"><Link className="back-link" to="/lookup"><ArrowLeft size={15} /> Exit checkout</Link><StepIndicator current={otpVerified ? 3 : 2} /><span className="secure-label"><LockKeyhole size={14} /> Secure checkout</span></div><div className="checkout-grid"><div className="checkout-main"><span className="eyebrow">Almost at the good part</span><h1>Verify, then take your seats.</h1><p className="page-lede">A quick phone check keeps every booking tied to a real guest and protects your hold.</p><HoldProgress seconds={countdown.seconds} progress={countdown.progress} expired={countdown.expired} /><Card className="verify-card"><div className="card-heading"><div className="step-icon">1</div><div><h2>Confirm your phone</h2><p>We’ll send a one-time code. We never show or log it.</p></div></div><label className="field-label" htmlFor="phone">Phone number</label><div className="input-with-icon"><Phone size={16} aria-hidden="true" /><input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="e.g. +1 555 014 2040" disabled={countdown.expired || otpSend.isPending} /></div><div className="field-action-row"><Button variant="secondary" disabled={!phoneValid || countdown.expired || resendSeconds > 0} loading={otpSend.isPending} onClick={() => otpSend.mutate()}>{resendSeconds > 0 ? `Resend in ${resendSeconds}s` : otpSend.isSuccess ? "Resend code" : "Send OTP"}</Button><span className="field-hint">Delivery can take a moment.</span></div>{otpSend.isSuccess ? <div className="otp-block"><span className="field-label">Six-digit code</span><OtpInput value={otp} onChange={setOtp} disabled={countdown.expired || otpVerify.isPending || otpVerified} /><div className="field-action-row"><Button disabled={otp.length !== 6 || countdown.expired || otpVerified} loading={otpVerify.isPending} onClick={() => otpVerify.mutate()}>{otpVerified ? <><CheckCircle2 size={16} /> Verified</> : "Verify code"}</Button><span className="field-hint">Enter the code sent to your phone.</span></div></div> : null}{statusMessage ? <p className="inline-status" role="status"><Info size={15} /> {statusMessage}</p> : null}</Card><Card className="pay-card"><div className="card-heading"><div className="step-icon">2</div><div><h2>Start payment</h2><p>Confirmation can take a few seconds—keep this page open.</p></div></div><div className="payment-assurance"><ShieldCheck size={18} /><span>Secure handoff <small>Your card details stay with the payment gateway.</small></span></div><Button className="pay-button" size="lg" disabled={paymentDisabled} loading={payMutation.isPending} onClick={() => payMutation.mutate()}>Pay {formatMoney(booking.amountCents, booking.currency)} <span aria-hidden="true">→</span></Button>{gatewayUnavailable ? <div className="expired-callout" role="alert"><TriangleAlert size={17} /><span><strong>Payments are temporarily unavailable</strong>Your seats remain held until the timer ends.<button type="button" className="button button--ghost button--sm" disabled={countdown.expired} onClick={() => payMutation.mutate()}>Retry payment</button></span></div> : null}{countdown.expired ? <div className="expired-callout" role="alert"><TriangleAlert size={17} /><span><strong>Hold expired</strong>{expiryText}<Link to={`/movies/${booking.showtime?.movieId ?? ""}`}>Choose seats again</Link></span></div> : !otpVerified ? <p className="pay-helper"><Info size={14} /> Verify your phone to unlock payment.</p> : null}</Card></div><aside className="checkout-side"><Card className="ticket-summary"><div className="ticket-summary__top"><span className="eyebrow">Your screening</span><StatusPill status={booking.status} /></div><h2>{booking.movie?.title ?? "Your movie"}</h2><p className="ticket-summary__meta">{booking.showtime?.theatreName ?? "CinemaSeat"} · {booking.showtime?.screenName ?? "Screen"}</p><p className="ticket-summary__meta">{formatDateTime(booking.showtime?.startsAt)}</p><div className="summary-divider" /><div className="summary-seat-list"><span>Seats</span><strong>{booking.seats.map((seat) => seat.label).join(", ") || "—"}</strong></div><div className="price-lines"><div><span>Tickets</span><strong>{formatMoney(booking.amountCents, booking.currency)}</strong></div><div><span>Fees</span><strong>{formatMoney(0, booking.currency)}</strong></div><div className="price-total"><span>Total</span><strong>{formatMoney(booking.amountCents, booking.currency)}</strong></div></div><div className="booking-ref"><span>Booking reference</span><code>{booking.ref}</code></div></Card><p className="privacy-note"><ShieldCheck size={15} /> Only your booking reference is stored locally. Payment data never touches CinemaSeat.</p></aside></div></div>;
}
