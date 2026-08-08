# ADR 0003 — Single deploy environment

## Context

We have a single Linux VM. The CD pipeline currently targets it over SSH.

A multi-environment set up (dev / staging / prod) is the orthodox
choice. It is also a 2× cost and a 2× story for every configuration
change.

## Decision

We deploy to a single environment: `production`. The same environment
serves demo traffic, integration verification, and the live demo.

## Consequences

- **One place to roll back.** `IMAGE_TAG=<previous-sha> scripts/deploy.sh --pull`
  is the entire procedure.
- **The acceptance test is the prod test.** If `make prod` works,
  production works. There is no "works in staging, broken in prod" gap.
- **Configuration is shared.** Every secret in `.env` is the same secret
  on every deploy. There is no "staging secret" to forget to rotate.
- **Capacity is the limit.** A single VM has a single VM's worth of
  capacity. Past that, we revisit.

## Alternatives rejected

- **Dev / staging / prod.** Three environments, three sets of secrets,
  three deploy targets, three rollback procedures. The benefit is
  catching deploy bugs before they hit users; the cost is a permanent
  tax on every change. A single environment plus a fast rollback is
  leaner.
- **Single environment per service.** Same idea, smaller scope. Each
  service with its own VM is more isolation than the volume needs.
- **Serverless.** Higher operational cost, lower control. The 11-hour
  hackathon target is met by a single VM at a known cost.