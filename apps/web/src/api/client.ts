import { ErrorEnvelopeSchema } from "@baseplate/contracts";
import { ApiError } from "./types";
import { apiErrorSchema, asRecord } from "./schemas";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:4000";

const REQUEST_TIMEOUT_MS = 12_000;

function joinUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${cleanBase}/${cleanPath}`;
}

function requestIdFromHeaders(headers: Headers): string | undefined {
  return headers.get("x-request-id") ?? headers.get("x-correlation-id") ?? undefined;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
  const text = await response.text();
  return text || undefined;
}

function toApiError(response: Response, body: unknown): ApiError {
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  if (envelope.success) {
    const { code, message, requestId, details } = envelope.data.error;
    return new ApiError(message, {
      status: response.status,
      code,
      requestId: requestId ?? requestIdFromHeaders(response.headers),
      details,
      retryable: response.status >= 500 || response.status === 429,
    });
  }

  const parsed = apiErrorSchema.safeParse(body);
  const record = parsed.success ? parsed.data : asRecord(body);
  const requestId =
    requestIdFromHeaders(response.headers) ??
    (typeof record.requestId === "string" ? record.requestId : undefined) ??
    (typeof record.request_id === "string" ? record.request_id : undefined);
  let message = "Something went wrong. Please try again.";
  if (typeof record.message === "string" && record.message.trim()) message = record.message;
  else if (typeof record.error === "string" && record.error.trim()) message = record.error;
  else if (typeof body === "string" && body.trim()) message = body;

  if (response.status === 409) message = "Those seats are no longer available.";
  if (response.status === 429) message = "Too many attempts. Please wait a moment and try again.";
  if (response.status === 503) message = "Payments are temporarily unavailable.";

  return new ApiError(message, {
    status: response.status,
    code: typeof record.code === "string" ? record.code : undefined,
    requestId,
    details: record.details,
    retryable: response.status >= 500 || response.status === 429,
  });
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  parse?: (body: unknown) => T,
): Promise<T> {
  const timeoutController = new AbortController();
  const timer = window.setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const externalSignal = init.signal;
  const abort = () => timeoutController.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted) timeoutController.abort();

  try {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(joinUrl(API_BASE_URL, path), {
      ...init,
      headers,
      signal: timeoutController.signal,
    });
    const body = await readBody(response);
    if (!response.ok) throw toApiError(response, body);
    return parse ? parse(body) : (body as T);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request took too long. Check your connection and try again.", {
        code: "TIMEOUT",
        retryable: true,
      });
    }
    throw new ApiError("We could not reach CinemaSeat. Check your connection and try again.", {
      code: "NETWORK_ERROR",
      retryable: true,
    });
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
