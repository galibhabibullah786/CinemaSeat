import type { ButtonHTMLAttributes, HTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { AlertCircle, Check, Clock3, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "../lib/cn";
import { formatCountdown } from "../lib/format";
import { bookingStatusCopy } from "../lib/status";
import type { BookingStatus } from "../api/types";

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  return (
    <button
      className={cn("button", `button--${variant}`, `button--${size}`, className)}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("card", className)} {...props}>{children}</section>;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" | "danger"; className?: string }) {
  return <span className={cn("badge", `badge--${tone}`, className)}>{children}</span>;
}

export function StatusPill({ status }: { status: BookingStatus }) {
  const copy = bookingStatusCopy[status];
  return <span className={cn("status-pill", `status-pill--${copy.tone}`)}><span className="status-pill__dot" aria-hidden="true" />{copy.label}</span>;
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} aria-hidden="true" {...props} />;
}

export function MoviePoster({ src, title, className, ...props }: ImgHTMLAttributes<HTMLImageElement> & { title: string }) {
  return (
    <div className={cn("poster-frame", className)}>
      <div className="poster-fallback" aria-hidden="true"><Sparkles size={22} /><span>{title.slice(0, 2).toUpperCase()}</span></div>
      {src ? <img src={src} alt={`${title} poster`} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} {...props} /> : null}
    </div>
  );
}

export function EmptyState({ icon = <Sparkles size={20} />, title, message, action }: { icon?: ReactNode; title: string; message: string; action?: ReactNode }) {
  return <div className="state-card state-card--empty"><div className="state-icon">{icon}</div><h2>{title}</h2><p>{message}</p>{action}</div>;
}

export function ErrorState({ title = "The projector blinked", message, requestId, onRetry }: { title?: string; message: string; requestId?: string; onRetry?: () => void }) {
  return (
    <div className="state-card state-card--error">
      <div className="state-icon"><AlertCircle size={20} /></div>
      <h2>{title}</h2><p>{message}</p>
      {requestId ? <small>Request ID <code>{requestId}</code></small> : null}
      {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw size={15} /> Try again</Button> : null}
    </div>
  );
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return <div className="page-loader" role="status"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>;
}

export function LiveIndicator({ label = "Live" }: { label?: string }) {
  return <span className="live-indicator"><span className="live-indicator__dot" aria-hidden="true" />{label}</span>;
}

export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Seats", "Verify", "Pay"];
  return <ol className="stepper" aria-label="Booking progress">
    {steps.map((step, index) => {
      const number = index + 1;
      return <li key={step} className={cn("stepper__item", number === current && "is-current", number < current && "is-complete")}><span className="stepper__number">{number < current ? <Check size={14} /> : number}</span><span>{step}</span></li>;
    })}
  </ol>;
}

export function Countdown({ seconds, expired = false, label = "Hold active" }: { seconds: number; expired?: boolean; label?: string }) {
  const announcement = expired ? "Seat hold expired" : [60, 30, 10].includes(seconds) ? `${seconds} seconds remain on your seat hold` : "";
  return <div className={cn("countdown", expired && "countdown--expired")}><Clock3 size={16} aria-hidden="true" /><span><strong>{expired ? "Expired" : formatCountdown(seconds)}</strong><small>{expired ? "Choose seats again" : label}</small></span><span className="sr-only" aria-live="polite">{announcement}</span></div>;
}

export function OfflineBanner() {
  return <div className="offline-banner" role="status"><AlertCircle size={15} /> You’re offline. Live inventory will refresh when you reconnect.</div>;
}
