import type { Booking } from "../api/types";

export function canStartPayment(booking: Booking | undefined, otpVerified: boolean, expired: boolean): boolean {
  return Boolean(booking?.status === "HELD" && otpVerified && !expired);
}
