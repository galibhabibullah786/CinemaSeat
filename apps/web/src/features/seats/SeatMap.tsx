import { Check, CreditCard, LockKeyhole } from "lucide-react";
import { memo, useMemo } from "react";
import type { Seat } from "../../api/types";
import { canSelectSeat, seatStatusCopy } from "../../lib/status";
import { formatMoney } from "../../lib/format";
import { cn } from "../../lib/cn";

export interface SeatButtonProps {
  seat: Seat;
  selected: boolean;
  onToggle: (seat: Seat) => void;
  disabled?: boolean;
}

export const SeatButton = memo(function SeatButton({ seat, selected, onToggle, disabled = false }: SeatButtonProps) {
  const effectiveStatus = selected ? "SELECTED" : seat.status;
  const unavailable = !canSelectSeat(seat.status) || disabled;
  const statusLabel = seatStatusCopy[effectiveStatus];
  return <button
    type="button"
    className={cn("seat-button", `seat-button--${effectiveStatus.toLowerCase()}`, seat.seatNumber === 7 && "seat-button--aisle-start")}
    disabled={unavailable}
    aria-pressed={selected}
    aria-label={`Row ${seat.rowLabel}, seat ${seat.seatNumber}, ${statusLabel}, ${formatMoney(seat.priceCents)}`}
    title={`${seat.label} · ${statusLabel}`}
    onClick={() => onToggle(seat)}
  >
    {selected ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
    {!selected && seat.status === "HELD" ? <LockKeyhole size={12} aria-hidden="true" /> : null}
    {!selected && seat.status === "PAYMENT_PENDING" ? <CreditCard size={12} aria-hidden="true" /> : null}
    <span>{seat.seatNumber}</span>
  </button>;
});

export function SeatMap({ seats, selectedIds, onToggle, disabled = false }: { seats: Seat[]; selectedIds: string[]; onToggle: (seat: Seat) => void; disabled?: boolean }) {
  const rows = useMemo(() => {
    const map = new Map<string, Seat[]>();
    for (const seat of seats) map.set(seat.rowLabel, [...(map.get(seat.rowLabel) ?? []), seat]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [seats]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  return <div className="seat-map" aria-label="Cinema seat map">
    <div className="seat-map__column-labels" aria-hidden="true"><span />{Array.from({ length: Math.max(12, ...seats.map((seat) => seat.seatNumber)) }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
    {rows.map(([row, rowSeats]) => <div className="seat-row" key={row}><span className="seat-row__label" aria-hidden="true">{row}</span><div className="seat-row__seats">{rowSeats.sort((a, b) => a.seatNumber - b.seatNumber).map((seat) => <SeatButton key={seat.id} seat={seat} selected={selected.has(seat.id)} onToggle={onToggle} disabled={disabled} />)}</div></div>)}
  </div>;
}

export function SeatLegend() {
  return <div className="seat-legend" aria-label="Seat legend">
    <span><i className="legend-seat legend-seat--available" />Available</span>
    <span><i className="legend-seat legend-seat--selected"><Check size={11} /></i>Selected</span>
    <span><i className="legend-seat legend-seat--held"><LockKeyhole size={11} /></i>Held</span>
    <span><i className="legend-seat legend-seat--booked" />Booked</span>
  </div>;
}
