# ADR 0002 — Repository seam for persistence

## Context

The service layer must be:

- **Testable without a database.** A unit test that builds a Postgres
  container is not a unit test; it is a slow, expensive integration
  test.
- **Agnostic to the persistence technology.** If we want to swap Postgres
  for SQLite (for local dev) or for an in-memory store (for a queue
  consumer), the change should be local, not a thousand-line refactor.
- **Composable into transactions.** The idempotency guarantee depends on
  the business write and the dedupe row committing atomically. A
  repository that captures its own client cannot participate in someone
  else's transaction.

## Decision

Every persistence operation is hidden behind an interface. The service
depends on the interface; the interface is implemented by a Prisma-backed
class. Every method takes a `DbClient` as its first argument rather than
capturing one.

```ts
// Good
const record = await this.deps.items.create(tx, data);

// Bad
const record = await this.deps.items.create(data);
```

## Consequences

- **Unit tests are fast and simple.** A fake repository is ~20 lines (see
  `apps/api/src/__tests__/helpers.ts`). No container, no pool, no
  migration.
- **The repository participates in transactions.** The idempotency pattern
  works because the ledger insert and the business write run in the same
  `$transaction` block.
- **Prisma generated-client drift is visible.** A schema change that
  renames a column is a compile error in the Prisma implementation, not
  a runtime failure in production.
- **Two ways to write the same query.** The repository is the only
  blessed path. New code does not import `db.item.create` directly.

## Alternatives rejected

- **Prisma-only, no interface.** Faster to write; an integration test
  suite is the only way to verify behaviour. The unit suite becomes
  either impossible or a `vi.fn()` exercise that proves nothing.
- **Custom DAO per table.** The interface is the same idea, but the
  granularity is wrong. We want one seam the service depends on, not
  dozens.
- **Hexagonal architecture with ports and adapters.** Heavier than this
  problem. The interface IS the port; the Prisma class IS the adapter.
  Adding a layer of indirection on top of indirection is not earned
  complexity.