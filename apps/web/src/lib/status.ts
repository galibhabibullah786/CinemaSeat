import type { BookingStatus, SeatStatus } from "../api/types";

export const bookingStatusCopy: Record<BookingStatus, { label: string; tone: "neutral" | "warning" | "info" | "success" | "danger" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  HELD: { label: "Hold active", tone: "warning" },
  AWAITING_PAYMENT: { label: "Awaiting payment", tone: "info" },
  PAYMENT_PENDING: { label: "Payment pending", tone: "info" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  FAILED: { label: "Payment not completed", tone: "danger" },
  EXPIRED: { label: "Hold expired", tone: "danger" },
  REFUND_REQUIRED: { label: "Refund required", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

export const seatStatusCopy: Record<SeatStatus, string> = {
  AVAILABLE: "Available",
  HELD: "Held by another guest",
  PAYMENT_PENDING: "Payment pending",
  BOOKED: "Booked",
  SELECTED: "Selected",
};

export function canSelectSeat(status: SeatStatus): boolean {
  return status === "AVAILABLE" || status === "SELECTED";
}
