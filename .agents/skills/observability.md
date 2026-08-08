# Observability

**Trigger:** any code that runs in a process you don't have a debugger
attached to. (So, all production code.)

## RED and USE

**RED** is for requests:
- **R**ate — requests per second.
- **E**rrors — fraction of 5xx responses.
- **D**uration — p50, p95, p99 latency.

**USE** is for resources:
- **U**tilisation — how busy is the resource?
- **S**aturation — how much work is queued?
- **E**rrors — how often does the resource fail?

A request tells you about the user experience. A resource tells you about
the system. You need both.

## p50 / p95 / p99, not averages

The average latency of 10 requests, where one is 10s and nine are 10ms, is
~1 second. The user with the 10s request saw a 10s request. Averages hide
the long tail that IS your actual user experience.

- **p50**: typical user experience. Mostly fine to track.
- **p95**: a reasonable SLO target. Catches the long tail.
- **p99**: the worst case that happens often enough to matter. Catches the
  truly broken.

## Label cardinality

Every label on a metric is a column in the time-series database. Every
distinct value is a row. Unbounded labels fill the disk and make queries
impossible.

- **OK labels**: route (bounded), method, status (low-cardinality classes).
- **NOT OK**: user_id (unbounded), full URL (one row per uuid), request_id.

A bounded label is a constant or a small enum, never a user-supplied
string.

## Trace context

`traceparent` (W3C Trace Context) is how a request carries its identity
across services. Every async hop must preserve it.

- Receive `traceparent` from the inbound request.
- Pass it on every outbound HTTP / queue call.
- Log it on every line that handles a unit of work.
- If you spawn an async task, propagate it explicitly. AsyncLocalStorage is
  not magic across `setTimeout`.

The `correlation()` middleware in `apps/api/src/http/middleware/correlation.ts`
is the pattern.

## Structured log fields

A log line is JSON. The fields are the columns of your future SQL query.

**Always present:**
- `time` (ISO 8601 UTC)
- `level`
- `service` (the name of the process)
- `requestId`
- `traceId` / `spanId` when available

**Always meaningful:**
- The log message is a human-readable sentence: "request rejected", not
  "err=true".
- The context is structured: `{ method, route, status, durationMs }`, not
  a string-concatenated sentence.

**Never include:**
- The raw error message (it can contain user input or stack traces).
- Personally identifying information.
- Authorization headers, cookies, tokens, passwords.

Pino's `redact` covers the standard ones. Custom redact paths go in the
logger config, not at the call site.

## Health vs readiness

Two endpoints, two questions, never one:

| Endpoint   | Question                                | Fails when                        | Effect of failure              |
| ---------- | --------------------------------------- | --------------------------------- | ------------------------------ |
| `/health`  | "Is this process alive?"                | Event loop is stuck               | Restart the container          |
| `/ready`   | "Can this process serve traffic now?"   | Dependency is unreachable         | Stop routing traffic to it     |

**Never** make `/health` depend on a dependency. A 30-second database blip
restarts every replica simultaneously, exactly when the database is least
able to absorb a reconnect storm.

## What deserves an alert

A page at 3am is a system that needs a human. Every page must answer
"what should I do?".

- Error rate above threshold for >5 minutes: something is broken. Read
  the logs.
- Latency p99 above SLO for >5 minutes: something is slow. Read the
  dashboards.
- Disk above 80%: cleanup or expand. Don't wait for 100%.
- Pod restart count above threshold: it's crash-looping. Read the logs.

**Don't alert on:**
- A single 5xx. It will happen.
- CPU at 100% for 10 seconds. That's a spike.
- Memory at 60%. That's normal.

The threshold is "a human needs to do something AND the human can tell
what to do from the page alone".

## Dashboards that earn their keep

One dashboard per audience:

- **User experience**: RED per route. Latency p95/p99. Error rate.
- **System health**: USE per resource (DB connections, cache hit rate,
  memory).
- **Business**: requests per user, conversion, anything that maps to money.

Three dashboards. Not thirty.