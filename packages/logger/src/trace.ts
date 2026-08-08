import { randomUUID, randomBytes } from 'node:crypto';

import type { RequestContext } from './context.js';

/**
 * W3C Trace Context: `traceparent: 00-<32 hex trace-id>-<16 hex span-id>-<2 hex flags>`
 * https://www.w3.org/TR/trace-context/
 *
 * Parsed strictly. A malformed header is treated as ABSENT rather than as an
 * error: an upstream proxy sending garbage must not turn a good request into a
 * 400, and a half-parsed trace id links our span to a trace that does not exist.
 */
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** All-zero ids are explicitly invalid per the spec. */
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

export interface ParsedTraceparent {
  traceId: string;
  parentSpanId: string;
  sampled: boolean;
}

export function parseTraceparent(header: string | undefined): ParsedTraceparent | undefined {
  if (typeof header !== 'string') return undefined;

  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!match) return undefined;

  // Indices are guaranteed by the regex, but noUncheckedIndexedAccess makes
  // that explicit rather than assumed -- the compiler is right to insist.
  const [, version, traceId, parentSpanId, flags] = match;
  if (!version || !traceId || !parentSpanId || !flags) return undefined;

  // Version ff is forbidden. Higher versions must still be accepted with the
  // fields we understand -- that is what makes the format forward compatible.
  if (version === 'ff') return undefined;
  if (traceId === ZERO_TRACE_ID || parentSpanId === ZERO_SPAN_ID) return undefined;

  return {
    traceId,
    parentSpanId,
    // Bit 0 of the flags byte is "sampled".
    sampled: (parseInt(flags, 16) & 0x01) === 0x01,
  };
}

/** Serialise a context back into a traceparent for outbound calls. */
export function toTraceparent(ctx: Pick<RequestContext, 'traceId' | 'sampled'>): string | undefined {
  if (!ctx.traceId) return undefined;
  const spanId = randomBytes(8).toString('hex');
  return `00-${ctx.traceId}-${spanId}-${ctx.sampled ? '01' : '00'}`;
}

/**
 * Build the context for an inbound request.
 *
 * Precedence, deliberately: a valid `traceparent` wins, then an explicit
 * `x-request-id`, then we mint one. The client-supplied id is used only for
 * CORRELATION -- never for authorization, a cache key, or anything where an
 * attacker choosing the value would matter.
 */
export function contextFromHeaders(headers: {
  traceparent?: string | undefined;
  requestId?: string | undefined;
}): RequestContext {
  const trace = parseTraceparent(headers.traceparent);

  // Bound the accepted length: an unbounded header value ends up in every log
  // line and is a cheap way to blow up log storage.
  const supplied = headers.requestId?.trim();
  const clientId = supplied && supplied.length > 0 && supplied.length <= 128 ? supplied : undefined;

  if (trace) {
    return {
      requestId: clientId ?? trace.traceId,
      traceId: trace.traceId,
      parentSpanId: trace.parentSpanId,
      sampled: trace.sampled,
    };
  }

  return { requestId: clientId ?? randomUUID() };
}
