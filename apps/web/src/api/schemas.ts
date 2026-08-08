import { z } from "zod";

/**
 * Backend responses are intentionally permissive here. The adapter below owns
 * the field-name translation so a contract change never leaks into a page.
 */
export const unknownRecordSchema = z.record(z.unknown());
export const unknownListSchema = z.array(z.unknown());

export const apiErrorSchema = z
  .object({
    message: z.string().optional(),
    error: z.string().optional(),
    code: z.string().optional(),
    requestId: z.string().optional(),
    request_id: z.string().optional(),
    details: z.unknown().optional(),
  })
  .passthrough();

export function asRecord(value: unknown): Record<string, unknown> {
  const parsed = unknownRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of ["data", "items", "results", "movies", "showtimes", "seats"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

export function readString(record: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

export function readNumber(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return fallback;
}

export function readBoolean(record: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}
