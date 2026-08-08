# ADR 0008 — CI gates CD via `workflow_run`

## Context

`ci.yml` and `cd.yml` were both triggered by `push: branches: [main]`.
Two workflows reacting to the same push race: the `cd` workflow starts
the moment a commit lands on `main`, before `ci` has had time to run
its checks. A deploy can therefore begin from a SHA whose tests,
typecheck, integration, security, or e2e suites have not yet passed —
or have already failed.

The race is not theoretical. A push that breaks the e2e suite triggers
both workflows. With `concurrency.cancel-in-progress: false` on CD (a
deliberate choice — see ADR-0003), the deploy job keeps running while
CI is failing.

A green build is a pre-requisite for a deploy, not an event that
happens to fire alongside it.

## Decision

CD is triggered by `workflow_run` on the `ci` workflow, not by `push`.
A small gate job at the top of `cd.yml` checks
`github.event.workflow_run.conclusion == 'success'`; if it is anything
else (`failure`, `cancelled`, `timed_out`, ...), the downstream jobs
are skipped.

```yaml
# cd.yml
on:
  workflow_run:
    workflows: [ci]
    types: [completed]
  workflow_dispatch: {}

jobs:
  gate:
    if: >
      github.event_name == 'workflow_dispatch' ||
      (github.event.workflow_run.conclusion == 'success')
```

The image SHA that CD builds and deploys is read from the triggering
CI run (`github.event.workflow_run.head_sha`), not from `github.sha`.
For `workflow_dispatch`, it falls back to the workflow's own `head_sha`.

## Consequences

- **CD never runs on a red CI.** The `workflow_run` event only fires
  once CI reaches a terminal state, and the gate enforces the
  `success` filter. A failing CI silently short-circuits the deploy.
- **The deploy and the CI run share a SHA.** Reading
  `workflow_run.head_sha` removes the race where a fast push lands a
  new commit between CI running and CD kicking off.
- **`workflow_dispatch` still works.** A manual trigger bypasses the
  gate's CI check and uses the workflow's own SHA, so break-glass
  deploys remain possible.
- **Fork PRs cannot reach CD.** The CI workflow refuses to run the
  GHCR-needing jobs on forks; without a successful CI run there is no
  `workflow_run` event for CD to react to.
- **Concurrency group still applies.** `cd-${{ head_branch }}` keeps
  only one deploy per branch in flight, independent of the trigger
  source. The previous protection (a long deploy + a fast push
  colliding) is preserved.

## Alternatives rejected

- **`push` trigger + a polling check inside the deploy job.** The
  deploy job would still start; the cancel logic is racing the deploy
  job, not gating it. Worse, the job holds a runner while it polls.
- **GitHub Environments required reviewers.** Adds a human gate but
  does not solve the missing CI check. It is an additional safety
  net, not a substitute for the CI gate.
- **`needs: ci` on a single combined workflow.** The CI workflow
  builds images, scans them, runs e2e, and tears down compose. A
  deploy job sitting at the end of that workflow would inherit the
  runner's lifetime, the cache state, and the e2e compose stack —
  none of which it wants. Two workflows with a clean handoff is the
  separation.
- **Branch protection rule "require status checks".** The check is
  enforced, but only on PRs. Direct pushes to `main` (admin override,
  accidental force-push) bypass it. The `workflow_run` event catches
  everything that lands on `main`.
