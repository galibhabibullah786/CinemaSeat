---
name: correctness-and-concurrency
description: Load when designing or reviewing code with state machines, transactions, idempotency, locks, or any concurrency-sensitive logic. Forces the author to enumerate the boundary cases and write the test that would catch each one.
---

# Correctness & Concurrency

Use when the change touches any of: a state machine, a transaction, an
idempotency ledger, a lock, a queue, a retry, or anything whose contract
breaks under concurrent execution.

Full skill body lives in **`.agents/skills/correctness-and-concurrency.md`**.