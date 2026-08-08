import type { ReactNode } from "react";

export function MobileBookingBar({ children }: { children: ReactNode }) {
  return <div className="mobile-booking-bar"><div className="shell mobile-booking-bar__inner">{children}</div></div>;
}
