const RECENT_KEY = "cinemaseat:recent-bookings";
const ACTIVE_KEY = "cinemaseat:active-booking";
const MAX_RECENT = 5;

function readRefs(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecentBookingRef(ref: string): void {
  if (!ref) return;
  try {
    const refs = [ref, ...readRefs().filter((item) => item !== ref)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(refs));
    sessionStorage.setItem(ACTIVE_KEY, ref);
  } catch {
    // Storage can be disabled in private browsing; booking flow still works.
  }
}

export function getRecentBookingRefs(): string[] {
  return readRefs();
}

export function getActiveBookingRef(): string | undefined {
  try {
    return sessionStorage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
