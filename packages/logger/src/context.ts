import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request correlation data.
 *
 * `requestId` is ALWAYS present -- generated if the client did not supply one.
 * `traceId`/`parentSpanId` are present only when a valid W3C `traceparent`
 * arrived, because inventing a trace id that no collector knows about produces
 * orphan spans that are worse than no spans.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly traceId?: string;
  readonly parentSpanId?: string;
  readonly sampled?: boolean;
}

/**
 * Why AsyncLocalStorage and not a `req`-threading parameter:
 * the service and repository layers must not take an Express `Request` just to
 * log a correlation id -- that would couple the domain to the transport. ALS
 * carries it invisibly across every await in the same logical request.
 *
 * The catch, and it is a real one: ALS context is LOST across anything that
 * breaks the async chain -- an EventEmitter listener registered outside the
 * request, a `setInterval` callback, a worker thread, or a promise captured in
 * a module-level cache. In those places the id must be passed explicitly.
 * See .agents/skills/observability.md.
 */
const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` visible to every async descendant. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The active context, or undefined outside a request (startup, cron, tests). */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The active request id, or '-' when there is none.
 *
 * Returns a sentinel rather than throwing: a logging call must never be the
 * thing that takes down a background job. '-' is the conventional "absent"
 * marker in access logs and is trivially greppable.
 */
export function getRequestId(): string {
  return storage.getStore()?.requestId ?? '-';
}
