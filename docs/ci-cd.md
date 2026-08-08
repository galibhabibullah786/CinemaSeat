# CI/CD pipeline

The pipeline is split across two workflows:

- **`.github/workflows/ci.yml`** — runs on every push to `main` and
  every pull request targeting `main`. Lint, typecheck, unit tests,
  integration tests (real Postgres), security scans (pnpm audit,
  gitleaks, Trivy filesystem), end-to-end tests (Playwright against
  `compose.prod`), and a Docker image build + scan.
- **`.github/workflows/cd.yml`** — runs ONLY when `ci.yml` finishes
  successfully on the same SHA, or on `workflow_dispatch`. Builds +
  pushes images to GHCR, then deploys over SSH to the production VM.

The gating decision is documented in [ADR-0008](adr/0008-ci-gates-cd.md).

## The CI -> CD contract

```
push to main / pull_request
        |
        v
   +---------+
   |   ci    |   (lint, typecheck, unit, integration, security, e2e,
   +---------+    docker build + scan)
        |
        | workflow_run, conclusion = success
        v
   +---------+
   |   cd    |   (build+push images -> SSH deploy -> poll /ready)
   +---------+
```

CD is triggered by `workflow_run` on the `ci` workflow, not by `push`.
A `gate` job at the top of `cd.yml` enforces
`conclusion == 'success'`; any other outcome (`failure`, `cancelled`,
`timed_out`, `skipped`) short-circuits the deploy. There is no path
from a red CI to a production deploy.

`workflow_dispatch` bypasses the gate by design — it is the
break-glass path described in the runbook.

## CI workflow shape

The CI workflow is shaped around a **path filter** job
(`.github/workflows/ci.yml: paths`) that produces a set of outputs
(`api`, `web`, `config`, `docker`, `everything`, ...). Downstream jobs
read these outputs and skip themselves when their scope is not
affected:

- `integration` runs only when `api` changed.
- `lint`, `typecheck`, `unit`, `security`, `e2e` run when
  `everything` changed (today: all jobs, but the filter is wired for
  future per-scope jobs).

A `setup` job installs dependencies once. Downstream jobs re-run
`pnpm install --frozen-lockfile`, which with the `setup-node` cache
restored resolves against the lockfile and exits quickly when nothing
has changed.

`docker-build` is the longest-running job (multi-stage buildx,
Trivy scan, GHA cache). It depends on every other quality gate. CD
pushes the same images with the same SHA tag — the build is
load-only here (`load: true`), push happens in `cd.yml`'s
`build-and-push`. The `latest` tag on GHCR is a convenience for
local `docker compose pull`; it is NEVER used for deploys
[ADR-0003].

## Permissions

The workflow-level default is `contents: read`. Each job that needs
more declares it:

- `ci > docker-build`: `packages: write` for GHCR.
- `cd > gate`: `contents: read` (the gate never touches GHCR).
- `cd > build-and-push`: `packages: write` for GHCR.
- `cd > deploy-ssh`: default `contents: read`; the SSH key is passed
  via `secrets.DEPLOY_SSH_KEY`, not via permissions.

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
| `mxschmitt/action-tmate` | v3.15 | `73f5c99ee9e93dd1055edce60b76402a2139164b` |
| `appleboy/ssh-action` | v1.0.3 | `029f5b4aeeeb58fdfe1410a5d17f967dacf36262` |

`github/codeql-action/upload-sarif` is pinned to the `@v3` tag in
`ci.yml` with a TODO note. Replace with the upstream commit SHA before
the workflow touches production secrets.

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
