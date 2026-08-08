# ADR 0009 — Images are built, scanned and pushed exactly once, in CI

## Context

Every image was built twice for every commit that reached production.

`ci.yml`'s `docker-build` job built the API image, scanned it with Trivy,
built the web image, and threw both away (`load: true`, no push).
`cd.yml`'s `build-and-push` job then built the same two images again from
the same SHA and pushed them to GHCR.

That is not just wasted runner minutes. It is a correctness problem:

- **The scanned artifact was not the deployed artifact.** CI scanned an
  image built with `provenance: false, sbom: false`. CD pushed a
  *different* build, with attestations, that no scan had ever looked at.
  The two were expected to be identical because the inputs were
  identical — an assumption nothing verified, and one that a
  non-reproducible step in the Dockerfile (`apk upgrade` against a live
  index, which the runtime stage deliberately does) breaks by design.
- **The web image was never scanned at all.** It is the only published
  service in the stack.
- **The `migrate` image was never built by either workflow.** The
  production host resolved `baseplate-migrate:${IMAGE_TAG}` from a
  `build:` stanza in `compose.prod.yaml`, i.e. it compiled the Prisma CLI
  image from source, on the production box, mid-deploy.
- **Tags disagreed.** CI tagged `sha-<full-40-char-sha>`; CD tagged
  `sha-<short-7>`. Two spellings of "the same image", one of which the
  runbook and `deploy.sh` do not recognise.

## Decision

**CI builds. CD deploys. Neither does the other's job.**

`ci.yml` owns the whole image lifecycle:

| Job | Responsibility |
| --- | --- |
| `image-meta` | Resolves the tag (`sha-<short>`) and the publish decision (`push` to main only) once, so no downstream job can disagree. |
| `image-api` | Builds `runtime` + `migrate` from `Dockerfile.api`, scans both, pushes both. |
| `image-web` | Builds, scans and pushes the web image. |
| `image-promote` | Backfills the SHA tag for images this commit did not change, then moves `:latest`. |

Each image is produced by exactly **one** `buildx` invocation, which
either loads it (pull request) or pushes it with provenance and SBOM
attestations (push to `main`). Trivy then scans *that* ref — the local
one on a PR, the registry one on a release. The bytes that were scanned
are the bytes that ship.

`cd.yml` has no build step. Its `verify-images` job asserts all three
tags resolve in GHCR and fails loudly if they do not.

### Path gating and the `image-promote` job

Image jobs are gated on a path filter (`api_image`, `web_image`) that
lists exactly the inputs that can change each image's content. A commit
touching only `apps/web` does not rebuild the API.

That breaks an invariant CD depends on: `compose.prod.yaml` resolves
`api`, `web` **and** `migrate` from a single `${IMAGE_TAG}`, so every
deployable SHA needs all three tags to exist.

`image-promote` restores it. For any image not rebuilt, it copies the
manifest `:latest` already points at onto the new SHA tag with
`docker buildx imagetools create` — a registry-side manifest copy. No
pull, no push, no rebuild, and the digest is unchanged, so "same tag,
same bytes" still holds. `:latest` moves afterwards, and only on a fully
green run.

## Consequences

- **One build per image per commit.** Roughly halves the Docker portion
  of a release.
- **The scan gates the deploy for real.** A HIGH/CRITICAL finding fails
  `image-api` or `image-web`, `image-promote` never runs, `:latest`
  never moves, and CD's `verify-images` has nothing new to deploy.
- **PRs still get full image coverage.** They build and scan; they just
  do not publish. A PR that publishes to GHCR would let anyone with
  branch-write access seed the registry.
- **`:latest` only ever points at a scanned image.** It is still never
  deployed — a rollback needs a coordinate that does not move
  [ADR-0003].
- **A missing image fails in the pipeline, not on the host.** The old
  behaviour was to discover it during `compose pull`, after the deploy
  had started.
- **A first run into an empty registry must build everything.** It does:
  `dorny/paths-filter` reports every path as changed when there is no
  base to diff against. If the registry is ever emptied by hand,
  `image-promote` fails with an explicit message rather than deploying a
  partial set.

## Alternatives rejected

- **Keep the CI build, and have CD pull-and-retag instead of
  rebuilding.** Solves the duplication but not the attestation gap: the
  scanned image still has to be pushed by something, so the push moves
  to CI anyway. This is that design, minus a redundant hop.
- **Build once in CD only, and skip image builds in CI.** A broken
  Dockerfile would then not be caught until after merge. The image build
  *is* a test.
- **Build and push both, then compare digests.** Verifies the assumption
  instead of removing it. Twice the cost, plus a new failure mode
  ("digests differ") with no useful remediation.
- **Do not path-gate; always build both images.** Simpler, and removes
  the need for `image-promote`. It also spends a full web build on every
  API-only commit, which is most commits. The manifest copy is seconds;
  the build is minutes.
