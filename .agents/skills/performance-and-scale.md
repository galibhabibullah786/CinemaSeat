# Performance & Scale

**Trigger:** any code that reads from a database, sends a network request,
or holds a connection.

## Checklist

### Indexes and query plans
- [ ] Every WHERE column has an index. EXPLAIN ANALYZE proves it's used.
- [ ] Composite indexes match the ORDER BY. A `(created_at DESC, id DESC)`
      ORDER BY is an index scan only when the index is also
      `(created_at DESC, id DESC)`.
- [ ] `SELECT *` is forbidden in production code paths. The query selects
      exactly the columns it reads.
- [ ] COUNT(*) for pagination is forbidden. Use keyset / cursor pagination.
- [ ] LIMIT without ORDER BY returns arbitrary rows. Always pair them.

### N+1 detection
- [ ] Any loop that issues a query per iteration is an N+1.
- [ ] Look for `for (const x of list) await repo.findById(x.id)`.
- [ ] Fix with a single `WHERE id IN (...)` and a Map lookup.
- [ ] Same for cascading renders in React: load the parent, then the child
      list in one round trip.

### Connection pool sizing (Little's Law: L = λW)
- [ ] `L = λ × W`. With arrival rate λ (req/s) and average latency W (s),
      L is the average number of in-flight requests.
- [ ] Pool size ≥ peak L. A smaller pool is a queue at the database driver;
      a larger pool is wasted memory.
- [ ] Cap by the database's `max_connections`. The API pool plus admin
      connections plus replication workers must fit.
- [ ] Postgres default `max_connections = 100`. Three services of 30 each
      is fine. Twenty services of 30 each is not.

### Caching
- [ ] Cache only at boundaries: response cache, query cache, computed cache.
- [ ] Every cache entry has an INVALIDATION STORY. A cache without one is a
      stale-read bug waiting to happen.
- [ ] Cache key includes a version number for forced-bust scenarios.
- [ ] Cache failure (Redis down) MUST NOT take the service down. Fall back
      to the database; emit a metric.

### Read models
- [ ] When the read shape diverges from the write shape, build a read model.
- [ ] A read model is a separate table populated by the write path (or a
      projector). Read latency drops; write latency goes up slightly.
- [ ] Never JOIN across the write and read models at query time.

### Hot-row contention
- [ ] A counter, balance, or status that EVERY request reads + writes is a
      hot row.
- [ ] Hot rows serialise. Latency grows linearly with request rate.
- [ ] Fix: shard the row (one counter per shard, sum on read), or use an
      append-only log + periodic aggregation, or move to an in-memory
      counter (lose on restart).

### Backpressure
- [ ] Every queue has a max size and a drop / spill policy.
- [ ] HTTP clients have timeouts (connect + read). NO `await fetch()` without
      a timeout.
- [ ] Database queries have timeouts at the driver level. A query that
      never returns is worse than a fast failure.

### Timeouts and bounded queues
- [ ] Every async operation has an explicit timeout. Default 5s for HTTP,
      30s for long jobs.
- [ ] Every buffer has a cap. `Array.push` in a hot loop is the prelude
      to OOM.
- [ ] `setInterval` MUST be `unref()`-ed if it shouldn't keep the process
      alive. The shutdown sweeper in `apps/api/src/http/middleware/rate-limit.ts`
      is the example.

### Metrics that matter
- [ ] RED: Rate, Errors, Duration. For every request.
- [ ] USE: Utilisation, Saturation, Errors. For every resource (DB, cache,
      memory).
- [ ] p50 / p95 / p99 — never averages. Averages hide the long tail that
      is your actual user experience.
- [ ] Label cardinality is bounded. `route` and `status` are OK; `user_id`
      is not.

### Load testing
- [ ] Load test BEFORE promising a number, not after.
- [ ] The test ramps up. A flat-line at N rps hides the moment the service
      tips over.
- [ ] Test failure modes: kill the database, kill one replica, double the
      latency. The system should fail loud, not slow.