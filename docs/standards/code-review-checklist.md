# Code review checklist

Reviewer runs through this list. Every unchecked item is a comment.

## Correctness

- [ ] The change is a vertical slice: contract → API → web → test → container → pipeline.
- [ ] The error envelope is consistent. Validation failures return
      `VALIDATION_FAILED`; not-found returns `NOT_FOUND`; etc.
- [ ] The service throws `AppError` subclasses; it does not write to
      `res.status(...)`.
- [ ] Cross-tenant or cross-user access returns 404, not 403.
- [ ] Idempotency keys are honoured where the operation has a side effect.
- [ ] Migrations are forward-only and backward-compatible.

## Security

- [ ] No hard-coded secrets. No `process.env` reads outside
      `apps/api/src/config/env.ts`.
- [ ] No PII in log lines. No request bodies in log lines.
- [ ] Input validation uses zod schemas. Strict object schemas.
- [ ] CORS is an allowlist (not `*`).
- [ ] Helmert/CSP headers are appropriate for the layer.
- [ ] No `dangerouslySetInnerHTML` or `eval`.

## Performance

- [ ] No N+1 queries. Loading a list of items does not issue one query
      per item.
- [ ] Pagination uses cursor (keyset), not OFFSET.
- [ ] Connection pool size is reasoned about (L = λW).
- [ ] Long-running operations have explicit timeouts.

## Tests

- [ ] A unit test exists for new service logic.
- [ ] An integration test exists for new HTTP behaviour.
- [ ] The tests are boundary-first: empty / one / many / edge cases.
- [ ] No test was modified to make faulty code pass.

## Documentation

- [ ] If a non-obvious decision was made, an ADR is added or updated.
- [ ] If user-visible behaviour changed, the README is updated.
- [ ] If a new env var was added, `.env.example` is updated.
- [ ] If a new behaviour is required at deploy time, the runbook is
      updated.

## Operational

- [ ] No new direct print/console.log. Use the logger.
- [ ] No new dependency without a justification in the PR description.
- [ ] No new file in `apps/api/src/` that depends on `process.env`
      directly.
- [ ] No new dependency on a deprecated or unmaintained package.

## Approve

A PR is approved when:

- All the above are checked.
- The CI run is green.
- The reviewer has run the change locally (where reasonable).