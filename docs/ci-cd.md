# CI/CD pipeline

The pipeline is split across two workflows:

- **`.github/workflows/ci.yml`** — runs on every push to `main` and
  every pull request targeting `main`. Lint, typecheck, unit tests,
  integration tests (real Postgres), security scans (pnpm audit,
  gitleaks, Trivy filesystem), end-to-end tests (Playwright against
  `compose.prod`), and the **image lifecycle**: build, scan and push.
- **`.github/workflows/cd.yml`** — runs ONLY when `ci.yml` finishes
  successfully for a push to `main`, or on `workflow_dispatch`.
  Verifies the images CI published, then deploys them to AWS EC2 over
  SSM. **CD builds nothing.**

Three decisions shape this:

| | |
| --- | --- |
| [ADR-0008](adr/0008-ci-gates-cd.md) | CI gates CD via `workflow_run`. |
| [ADR-0009](adr/0009-images-built-once-in-ci.md) | Images are built, scanned and pushed exactly once, in CI. |
| [ADR-0010](adr/0010-oidc-ssm-deploy-to-ec2.md) | The deploy transport is OIDC + SSM, not SSH. |

## The CI -> CD contract

```
push to main / pull_request
        |
        v
   +---------+   lint, typecheck, unit, integration, security, e2e
   |   ci    |   then: build + scan + push images, promote tags
   +---------+
        |
        | workflow_run, conclusion = success, event = push, branch = main
        v
   +---------+   verify the published tag -> OIDC -> SSM -> deploy.sh
   |   cd    |   -> migrate -> poll /ready
   +---------+
```

CD is triggered by `workflow_run` on the `ci` workflow, not by `push`.
The `gate` job at the top of `cd.yml` requires **three** things, not
one:

| Condition | Without it |
| --- | --- |
| `conclusion == 'success'` | `workflow_run` fires for `failure`, `cancelled` and `timed_out` too, and a red CI would deploy. |
| `event == 'push'` | CI also runs on `pull_request`. A green CI on an in-repo PR branch would deploy that branch to production. |
| `head_branch == 'main'` | A push to any other branch is not a release [ADR-0003]. |

`workflow_dispatch` bypasses the gate by design — it is the
break-glass and rollback path described in the runbook. Its optional
`tag` input is validated against an anchored allowlist in the `gate`
job before it reaches a shell on the production host.

## CI workflow shape

The CI workflow is shaped around a **path filter** job
(`.github/workflows/ci.yml: paths`) that produces a set of outputs
(`api`, `web`, `config`, `api_image`, `web_image`, `everything`, ...).
Downstream jobs read these outputs and skip themselves when their scope
is not affected:

- `integration` runs only when `api` changed.
- `image-api` runs only when `api_image` changed, `image-web` only
  when `web_image` changed. Those two filters list exactly the paths
  that can change each image's *content* — anything outside them
  produces byte-identical bits, so rebuilding is pure cost.
- `lint`, `typecheck`, `unit`, `security`, `e2e` run when
  `everything` changed (today: all jobs, but the filter is wired for
  future per-scope jobs).

A `setup` job installs dependencies once. Downstream jobs re-run
`pnpm install --frozen-lockfile`, which with the `setup-node` cache
restored resolves against the lockfile and exits quickly when nothing
has changed.

## Images

Four jobs, all downstream of every quality gate:

| Job | Does |
| --- | --- |
| `image-meta` | Resolves the tag (`sha-<short>`) and the publish decision (`push` on main only) **once**, so no downstream job can disagree about either. |
| `image-api` | Builds `runtime` + `migrate` from `Dockerfile.api` (one job: they share every layer through `build`), scans both with Trivy, pushes both. |
| `image-web` | Builds, scans and pushes the web image. |
| `image-promote` | Backfills the SHA tag for images this commit did not change, then moves `:latest`. |

Each image is produced by **one** `buildx` invocation whose exporter is
the only thing that varies:

| | pull request | push to main |
| --- | --- | --- |
| exporter | `load` (docker) | `push` (registry) |
| attestations | off — the classic image store cannot import an index | provenance + SBOM |
| Trivy scans | the local image | the pushed image (`TRIVY_USERNAME`/`PASSWORD`) |

Either way, **the bytes that were scanned are the bytes that ship**.
A HIGH/CRITICAL finding fails the image job, `image-promote` never
runs, `:latest` never moves, and CD has nothing new to deploy.

`image-promote` exists because the image jobs are path-gated while
`compose.prod.yaml` resolves `api`, `web` **and** `migrate` from a
single `${IMAGE_TAG}`. For any image not rebuilt, it copies the
manifest `:latest` already points at onto the new SHA tag with
`docker buildx imagetools create` — a registry-side manifest copy, so
the digest is unchanged. The `latest` tag on GHCR is a convenience for
local `docker compose pull`; it is NEVER used for deploys [ADR-0003].

## Permissions

The workflow-level default is `contents: read`. Each job that needs
more declares it:

- `ci > image-api`, `image-web`, `image-promote`: `packages: write`
  for GHCR.
- `cd > gate`: `contents: read` (the gate never touches GHCR).
- `cd > verify-images`: `packages: read`.
- `cd > deploy-ec2`: `id-token: write` — and nothing else. That
  permission mints the OIDC token `configure-aws-credentials`
  exchanges for 30-minute STS credentials. It is declared on this job
  alone; a workflow-level grant would hand an OIDC token to every job.

There is no `AWS_ACCESS_KEY_ID` and no `DEPLOY_SSH_KEY` in this
repository. See [deploy-aws-ec2.md](deploy-aws-ec2.md) for the AWS side.

Fork PRs never have write tokens; the relevant `if:` guards refuse to
run the GHCR-touching jobs. We deliberately do NOT use
`pull_request_target` with a checkout of the PR head — that
combination is a documented supply-chain attack vector.

## Action pinning

Every third-party action is pinned to a full commit SHA, with the
tag kept as a comment. See [ADR-0004](adr/0004-sha-pinned-actions.md).

The pin was last verified against the upstream registry on 2026-08-08.
Dependabot opens PRs that bump the SHAs as new versions ship.

| Action | Version | Verified SHA |
| --- | --- | --- |
| `actions/checkout` | v4.1.1 | `b4ffde65f46336ab88eb53be808477a3936bae11` |
| `actions/setup-node` | v4.0.0 | `8f152de45cc393bb48ce5d89d36b731f54556e65` |
| `actions/cache` | v4.2.0 | `1bd1e32a3bdc45362d1e726936510720a7c30a57` |
| `actions/upload-artifact` | v4.4.0 | `50769540e7f4bd5e21e526ee35c689e35e0d6874` |
| `pnpm/action-setup` | v4.0.0 | `0c17529a66aca453f9227af23103ed11469b1e47` |
| `dorny/paths-filter` | v3.0.2 | `de90cc6fb38fc0963ad72b210f1f284cd68cea36` |
| `gitleaks/gitleaks-action` | v2.3.0 | `1938557f6a58837331b99822ab17b8e536e7bef9` |
| `aquasecurity/trivy-action` | v0.24.0 | `6e7b7d1fd3e4fef0c5fa8cce1229c54b2c9bd0d8` |
| `docker/setup-qemu-action` | v3.2.0 | `49b3bc8e6bdd4a60e6116a5414239cba5943d3cf` |
| `docker/setup-buildx-action` | v3.6.1 | `988b5a0280414f521da01fcc63a27aeeb4b104db` |
| `docker/login-action` | v3.3.0 | `9780b0c442fbb1117ed29e0efdff1e18412f7567` |
| `docker/build-push-action` | v6.1.0 | `31159d49c0d4756269a0940a750801a1ea5d7003` |
| `github/codeql-action/upload-sarif` | v3.27.5 | `f09c1c0a94de965c15400f5634aa42fac8fb8f88` |
| `aws-actions/configure-aws-credentials` | v4.2.1 | `b47578312673ae6fa5b5096b330d9fbac3d116df` |
| `mxschmitt/action-tmate` | v3.15 | `73f5c99ee9e93dd1055edce60b76402a2139164b` |
| `appleboy/ssh-action` | v1.0.3 | `029f5b4aeeeb58fdfe1410a5d17f967dacf36262` |

`appleboy/ssh-action` is retained only for the commented break-glass
`deploy-ssh` job in `cd.yml` [ADR-0010]. `docker/setup-qemu-action` is
no longer used: the images are single-platform (`linux/amd64`) and QEMU
buys nothing until a second architecture is targeted.

## Local verification

Before pushing, the same gates run locally:

```bash
make ci-local
```

This is the path for fast feedback. The CI workflow is the same set
of commands with longer timeouts and a clean runner.

The workflow files are also linted with
[`actionlint`](https://github.com/rhysd/actionlint):

```bash
./actionlint
```

Run it from the repo root. The binary is installed globally on the
dev host; install it with
`go install github.com/rhysd/actionlint/cmd/actionlint@latest` if it
is missing. `make actionlint` is the wrapper.

## Concurrency

| Workflow | Group | Cancel-in-progress | Rationale |
| --- | --- | --- | --- |
| `ci` | `${{ workflow }}-${{ ref }}` | yes | A fast follow-up push supersedes the in-flight CI; we only care about the latest state. |
| `cd` | `cd-${{ head_branch }}` | no | Two overlapping deploys against the same DB can leave a half-migrated schema. See ADR-0003. |

## Failure modes

See [`runbook.md` -> "Common failures"](runbook.md#common-failures) for
the operator-facing catalogue. CI/CD-specific entries (CD did not run
after a push) live there.
