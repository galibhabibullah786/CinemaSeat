# ADR 0001 — Postgres as the primary database

## Context

We need a single database that:

- holds structured data with referential integrity,
- supports ACID transactions with strict serialisation guarantees,
- is open-source and operationally boring (so an 11-hour hackathon can
  run it without a database specialist),
- is reachable from a managed-hosting environment without a license.

## Decision

We use Postgres 16.

## Consequences

- **Strong typing + rich constraints.** Check constraints, unique
  constraints, foreign keys, generated columns. Idempotency is enforced at
  the database, not in the application (the `IdempotencyRecord` table is the
  example).
- **Mature tooling.** `pg_isready`, `psql`, `pg_dump`, `pg_basebackup` are
  all bundled. The Prisma client is well-supported.
- **Operational simplicity.** A single container, a single connection
  string, a single volume. `docker exec db psql` is enough for inspection.
- **No replication topology at this stage.** A single instance is fine for
  the volume we target. When volume demands it, we add a read replica with
  a separate connection string.

## Alternatives rejected

- **SQLite.** No concurrent writes, no server-side constraints as rich,
  no separate process to fail over. Not even worth the operational
  simplicity for a backend that talks to a database.
- **MongoDB.** No foreign keys, no transactions across documents in older
  versions, and the data shape here is relational. Picking a document
  store because it sounds "modern" is how you get a database migration
  three weeks in.
- **MySQL.** Comparable in capability, but the unique-constraint error
  code is different (`ER_DUP_ENTRY = 1062`), the tooling for partial
  indexes is absent, and the team's operational experience is more
  Postgres-flavoured. Switching is a one-day cost; doing it because
  someone prefers it is not a reason.
- **CockroachDB / Spanner.** Distributed SQL is not a problem we have at
  the scale we target. Picking it adds a deployment story we don't need.