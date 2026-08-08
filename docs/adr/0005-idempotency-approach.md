# ADR 0005 — Idempotency-by-key with database-enforced uniqueness

## Context

`POST /items` is a write endpoint. A write endpoint that retries must
not produce two writes. We need:

- A client retry that arrives seconds after the original returns the
  SAME response, byte for byte.
- A client retry that arrives WHILE the original is still in flight
  returns immediately with a typed error, not a duplicate write.
- A retry with the SAME key but a DIFFERENT body is a client bug, and
  the response is a 409, not a misleading "success".

## Decision

We use `Idempotency-Key` as an OPTIONAL header on write endpoints. The
implementation:

1. Hash the request body (canonicalised JSON, sorted keys) into a
   `requestHash`.
2. Look up the (endpoint, key) pair in the `IdempotencyRecord` table.
3. If a record exists with the same `requestHash`, return the stored
   response and a `replayed: true` flag.
4. If a record exists with a DIFFERENT `requestHash`, return 409.
5. If no record exists, perform the business write AND insert the
   dedupe row, in ONE `$transaction`. The (endpoint, key) pair is
   uniquely constrained.
6. If the unique constraint fires (concurrent requests with the same
   key), return 409 immediately. Do NOT block waiting for the winner.

## Consequences

- **Correctness is in the database.** A unique constraint is the only
  ordering mechanism that sees all concurrent transactions.
- **The fast path is fast.** A retry seconds later hits the `find`,
  reads the stored response, and returns. No business logic re-runs.
- **The slow path is correct.** The ledger row and the business write
  commit together. There is no window where one exists and the other
  doesn't.
- **The race is bounded.** The first transaction holds the unique
  index lock for the duration of the transaction (capped at 5s). The
  second transaction fails fast with P2002 -> 409.
- **The signature is documented.** `Idempotency-Key` is the standard
  header. A client retrying with this header is using a known contract.

## Alternatives rejected

- **No idempotency.** At-most-once-per-attempt is the honest contract
  of "no header". Any client that retries must then accept the
  possibility of duplicates.
- **Application-level check-then-act.** `find` then `create` is a lost
  update race. Two concurrent requests both see "no record", both
  proceed, both write. The unique constraint is the only correct
  fix.
- **Redis-based dedupe.** Faster, but a new dependency. The
  Postgres-enforced approach is correct at the cost of one round
  trip; the speed-up is not worth the second moving part.
- **Upsert into the ledger.** Silently overwrites the stored response,
  destroying the guarantee. The exact failure mode this is designed to
  prevent.
- **Poll for the winner's result.** The 409-don't-wait rule is
  deliberate. Blocking turns a retry storm into an exhausted connection
  pool.