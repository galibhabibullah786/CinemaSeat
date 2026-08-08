# Testing

**Trigger:** writing or reviewing any code change.

## What deserves what

| Layer          | Tool                  | Asserts                                    | Speed       |
| -------------- | --------------------- | ------------------------------------------ | ----------- |
| Unit           | vitest                | A function's logic in isolation            | ms          |
| Integration    | vitest + supertest    | The HTTP surface against a real dependency | seconds     |
| E2E            | Playwright            | The user-visible flow across stacks        | tens of s   |
| Load           | k6 / vegeta           | Throughput, latency under pressure         | minutes     |
| Property       | fast-check            | Invariants over random inputs              | varies      |

**Rule:** put the test as LOW as it can still exercise the behaviour.

- A bug in `parseInt` is a unit test.
- A bug in `validateRequest → service.create` is an integration test.
- A bug in the SPA's form submission is an e2e test.
- A bug in the system's ability to absorb 10× traffic is a load test.

## Boundary-first test design

For each function, name the boundaries:

- empty / one / many
- 0 / 1 / MAX_INT / MIN_INT / NaN
- missing / null / undefined / wrong type
- concurrent first / concurrent second / winner / loser
- exactly-at-the-edge / just-past-the-edge

Write a test for EACH boundary, not for each happy path. The bug is at a
boundary.

## The three review passes

Before merging any test, walk through it three times:

### Pass 1 — assume unimplemented
Would this test fail against a stub that always returns "OK"? If no, the
assertion is too loose. Tighten it.

### Pass 2 — assume implemented naively
Would the obvious implementation pass all the tests? If yes, the test is
too easy. Add the boundary the obvious implementation would miss.

### Pass 3 — assume buggy and insecure
Would a bug that:
- swaps the order of two writes,
- reuses a response body when it should compute a fresh one,
- leaks a key instead of redacting it,
- uses `==` instead of `===`,
- trusts a header that's attacker-controlled,
- short-circuits on the first match instead of the last,

...get caught? If no, write the test that catches it.

## The one rule

**A failing test is never edited to make faulty code pass.** If a test
breaks the build, the bug is in the code OR the test is no longer
exercising the right behaviour. Either way, the resolution is to understand
why, not to silence the alarm.

## Patterns

### Arrange-Act-Assert, named
```ts
it('returns the stored body on idempotent replay', async () => {
  // arrange
  const first = await service.create(...);
  // act
  const second = await service.create(...);
  // assert
  expect(second.body).toEqual(first.body);
  expect(second.replayed).toBe(true);
});
```

### Test the failure you documented, not a different one
If the public message is "Item not found.", assert that — don't assert a
substring that happens to be present.

### Don't mock what you can fake
- A mock (`vi.fn()`) tests that you called the function.
- A fake (a real implementation with no IO) tests that the behaviour is
  correct.

Mock the boundary that would be slow (network, DB), fake the rest.

### Determinism
- `Date.now()` and `Math.random()` are test smells. Inject a clock.
- File system and port binding are test smells. Use a tmpfs + a free port.

## Failure modes that always need a test

- Idempotent replay (same key, same body → identical response, no second effect).
- Idempotent conflict (same key, different body → 409).
- Hot-row race (two concurrent requests, one wins, the other gets 409).
- Empty list (the first request the user ever makes).
- Last page of pagination (nextCursor is null, not "missing").
- Validation rejection (zod schema fails BEFORE the handler runs).
- /ready when the database is down.
- /health when /ready is down.
- Shutdown initiated while a request is in flight.

If a feature has any of these, it has a test.