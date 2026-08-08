import type { Seat } from "../../api/types";

export interface SelectionResult { ids: string[]; limitReached: boolean }

export function toggleSeatSelection(current: string[], seat: Seat, max: number): SelectionResult {
  if (current.includes(seat.id)) return { ids: current.filter((id) => id !== seat.id), limitReached: false };
  if (seat.status !== "AVAILABLE") return { ids: current, limitReached: false };
  if (current.length >= max) return { ids: current, limitReached: true };
  return { ids: [...current, seat.id], limitReached: false };
}

export function removeConflictingSeats(current: string[], conflictingIds: string[]): string[] {
  const conflicts = new Set(conflictingIds);
  return current.filter((id) => !conflicts.has(id));
}
