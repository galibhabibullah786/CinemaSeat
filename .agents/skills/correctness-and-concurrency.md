# Correctness & Concurrency

**Trigger:** any code that touches more than one request, transaction, or
process boundary.

## Checklist

### Check-then-act races (lost updates)
- [ ] Is the read-and-write inside one SQL statement or one transaction?
  - [ ] If no: another request can interleave between the read and the write.
- [ ] For a "create if not exists": is the unique constraint the arbiter,
      not `find` + `create`?
- [ ] For a "decrement by N": is it a conditional UPDATE returning rowcount?
      `UPDATE x SET q = q - ? WHERE q >= ?` returns 0 rows if the precondition
      fails — that is the answer, not a separate `SELECT`.

### Conditional update as CAS
- [ ] When the new state depends on the current state, the WHERE clause must
      name the assumed current state.
- [ ] If rowcount = 0, that is a different error than "not found": the row
      moved out from under you.
- [ ] For counters and balances, this is the ONLY correct pattern. Reads +
      writes are wrong.

### Unique constraints as the enforcement layer
- [ ] Any invariant about uniqueness is enforced at the DATABASE level.
- [ ] Application-level "look first, then write" is a hint, not a guarantee.
- [ ] P2002 (Prisma) / 23505 (Postgres) is the success signal: "someone else
      got there first". Do NOT swallow it.
- [ ] Map P2002 to a typed `ConflictError` / `IdempotencyConflictError`, not
      to 500.

### Transaction boundaries
- [ ] Is the transaction the SMALLEST unit that has to be atomic?
- [ ] Is the connection released at the END of the transaction, not after
      some unrelated await?
- [ ] If a side effect (HTTP, queue, email) is inside the transaction: it
      runs at most once on commit, at most zero times on rollback. Verify
      both.
- [ ] Set a transaction timeout. Stuck transactions hold locks until the
      connection dies — usually minutes.

### Isolation level
- [ ] Default in Postgres is READ COMMITTED. That is correct for most things.
- [ ] REPEATABLE READ is needed when: the transaction makes multiple reads
      that must see the SAME world, OR a uniqueness check spans multiple rows.
- [ ] SERIALIZABLE: needed for predicates across rows. Retry on 40001.

### Idempotency keys (server-side)
- [ ] POST endpoints that perform an effect should accept `Idempotency-Key`.
- [ ] The dedupe row is INSERTED IN THE SAME TRANSACTION as the effect.
- [ ] The unique key is (endpoint, key). Different routes MUST NOT collide.
- [ ] A repeat with the same key + same body returns the stored response
      byte-for-byte, including status code and Location header.
- [ ] A repeat with the same key + DIFFERENT body is a 409. The hash of the
      body must be canonicalised (sorted keys) so a reordering retry isn't
      rejected.
- [ ] A concurrent repeat: the second insert hits P2002 → return 409.
      DO NOT block waiting for the first to finish.

### At-least-once + idempotent consumer
- [ ] Any queue consumer MUST be idempotent. The broker WILL deliver the
      same message twice.
- [ ] Idempotency keys can come from the producer (preferred) or be derived
      from the message body (acceptable if the body is canonicalised).

### Transactional outbox
- [ ] When you write to the DB and a side-effect to a queue, do BOTH in one
      transaction.
- [ ] A separate worker polls the outbox table and forwards to the queue.
- [ ] This is the only pattern that survives a crash between the two writes.

### Half-open intervals
- [ ] `[start, end)` for time windows. End is exclusive.
- [ ] `[closed, open)` for cursor pagination. The cursor id is the LAST
      item of the previous page; the next query skips it.

### Integer money + half-up rounding
- [ ] NEVER use float for money. Use integer cents.
- [ ] Round at the boundary, not in the middle. Tax + discount → round once
      at the end.

### Audit log = append-only
- [ ] Inserts only. No UPDATE, no DELETE. Ever.
- [ ] A trigger or a separate table for the audit, not a column on the
      record.
- [ ] If you need a "current" view, JOIN to the audit table and take the
      latest row.
- [ ] The retention policy is in the runbook. Make it explicit.

## Local invariants

For each invariant in your code, comment which layer enforces it and why
not a lower one:

```ts
// INVARIANT: quantity >= 0. Enforced HERE (DB column CHECK) rather than
// in the service layer because two concurrent UPDATEs can both pass a
// service-level check and both decrement.
```