# Runbook

Everything you need to operate this stack under pressure. Cross-references
to the ADRs are in `[ADR-0001]` style.

## Deploy

The target is a single AWS EC2 instance. First-time setup of that
instance and its IAM roles is
[deploy-aws-ec2.md](deploy-aws-ec2.md) — this section assumes it is
already done.

The CD pipeline is the intended path. It runs ONLY after a green CI on
the same SHA — the `workflow_run` trigger on `cd.yml` fires when the
`ci.yml` run completes successfully ([ADR-0008](adr/0008-ci-gates-cd.md)).
A red CI silently skips CD; there is no deploy from a failing check.

The `cd.yml` workflow can also be re-run by hand via `workflow_dispatch`
for break-glass scenarios and rollbacks.

```bash
# 1. Push to main.
git push origin main

# 2. Watch CI:    https://github.com/<owner>/<repo>/actions/workflows/ci.yml
# 3. Watch CD:    https://github.com/<owner>/<repo>/actions/workflows/cd.yml
#    CD is auto-triggered only when CI is green.
# 4. Confirm:     curl https://<your-host>/api/ready
```

CI publishes the images; CD deploys them and builds nothing
([ADR-0009](adr/0009-images-built-once-in-ci.md)).

The CI workflow, after its quality gates:
1. Builds, scans and pushes `baseplate-api`, `baseplate-migrate` and
   `baseplate-web` to GHCR, tagged `sha-<short-sha>` (immutable, what we
   deploy). Path-gated: only images whose inputs changed are rebuilt.
2. `image-promote` backfills the SHA tag for images that were not
   rebuilt, then moves `latest` (a convenience for local
   `docker compose pull`; never deployed).

The CD workflow:
1. `gate` — resolves the SHA and image tag; refuses anything that is not
   a green CI on a push to `main`.
2. `verify-images` — asserts all three tags resolve in GHCR. A missing
   image fails here, before the host is touched.
3. `deploy-ec2` — assumes an AWS role via OIDC (no stored credential),
   sends `scripts/deploy.sh --pull` to the instance with SSM Run
   Command, and streams the remote output into the job log
   ([ADR-0010](adr/0010-oidc-ssm-deploy-to-ec2.md)).
4. On the host, `deploy.sh` does: `docker compose pull` → `up -d` →
   wait for healthy → `prisma migrate deploy` → poll `/api/ready` until
   200 or 30 attempts. Migrations run as a deliberate separate step,
   never at container start.
5. Back on the runner, `${PUBLIC_URL}/api/ready` is polled from
   *outside* — the only check that also proves the security group and
   DNS work.

## Rollback

Rollback is a deploy of the previous tag. Nothing else changes.

**Actions → cd → Run workflow**, and set the `tag` input to the
previous `sha-<short>`:

```
tag: sha-9f2c1ab
```

`workflow_dispatch` bypasses the CI gate by design: during an incident
the thing you want to deploy is a commit whose CI passed hours ago.

To find the previous tag:

```bash
# GitHub: actions -> cd -> the last good run -> job summary table.
# Or, from the host:
aws ssm start-session --target <instance-id>
sudo docker ps --format '{{.Image}}'
```

If GitHub Actions itself is unavailable, do it on the host directly:

```bash
aws ssm start-session --target <instance-id>
cd /opt/baseplate
sudo IMAGE_TAG=sha-9f2c1ab bash scripts/deploy.sh --pull
```

`scripts/deploy.sh` gives a caller-supplied `IMAGE_TAG` precedence over
the one in `.env`, so this deploys exactly the tag named.

The `latest` tag is NOT used for rollback — it has moved.

## Break-glass merge

If GitHub Actions is unavailable and the demo is in 30 minutes:

1. Build the images locally:
   ```bash
   export IMAGE_TAG=manual-$(date +%Y%m%d-%H%M%S)
   make prod          # builds api + web
   docker compose -p baseplate-prod -f docker/compose.prod.yaml \
     --env-file .env --profile migrate build migrate
   ```
2. Push all THREE to GHCR. `compose.prod.yaml` resolves `api`, `web`
   and `migrate` from the same `${IMAGE_TAG}`; a missing `migrate`
   image means the migration step builds from source on the production
   host mid-deploy:
   ```bash
   docker login ghcr.io
   for i in api web migrate; do
     docker push "ghcr.io/<owner>/baseplate-$i:${IMAGE_TAG}"
   done
   ```
3. Deploy by hand, on the host:
   ```bash
   aws ssm start-session --target <instance-id>
   cd /opt/baseplate
   sudo IMAGE_TAG=manual-... bash scripts/deploy.sh --pull
   ```
4. Comment in the PR with a one-line explanation so the audit trail is
   intact.

These images were never scanned. Open an issue to rebuild through the
pipeline as soon as it is back.

## Common failures

### 0. CD never started after a push to main

Expected behaviour: CD is triggered by `workflow_run` on `ci.yml` and
the gate requires `conclusion == 'success'` [ADR-0008]. Check
`https://github.com/<owner>/<repo>/actions/workflows/ci.yml` for the
commit's CI run.

- If CI is red, fix the failing job and push. CD does not retry the
  red run; a new push produces a new CI -> CD pair.
- If CI is green but CD was skipped, check the `gate` job's condition.
  It requires the CI run to have come from a **push** to **main** — a
  green CI on a pull request deliberately does not deploy. Otherwise
  re-run `cd.yml` from the Actions UI with `workflow_dispatch`; the
  gate explicitly allows it, and the deploy uses the current `main`
  HEAD. The `tag` input can pin to a specific short SHA.
- If no CI run exists at all, the push did not land on `main`. CI does
  not run on feature branches.

### 0b. CD failed at `verify-images`

CD does not build images ([ADR-0009](adr/0009-images-built-once-in-ci.md));
the tag it wants was never published. Open the `ci` run for that SHA:

- `image-api` or `image-web` red → a Trivy HIGH/CRITICAL finding.
  See failure 3 below. Nothing was promoted, and `latest` still points
  at the last image that passed.
- `image-promote` skipped → CI was not a push to `main`, or an earlier
  gate failed.
- `image-promote` red with "has neither :`<tag>` nor :latest" → the
  registry has no prior manifest to copy for an image this commit did
  not change. Push an empty commit touching `docker/` to force a full
  rebuild.

### 0c. CD failed at `deploy-ec2` with an AWS error

`Not authorized to perform sts:AssumeRoleWithWebIdentity`,
`InvalidInstanceId`, and the rest of the setup-shaped failures are
catalogued in
[deploy-aws-ec2.md → Troubleshooting](deploy-aws-ec2.md#11-troubleshooting).
They are configuration problems, not release problems: the running
version is untouched, because `deploy.sh` pulls before it stops
anything.

### 1. /ready returns 503 but /health is 200

The database is unreachable. The API itself is fine; the orchestrator
should keep the container running and stop routing traffic.

What to do:
- `docker compose logs db` — Postgres OOM? Disk full? Init failure?
- `docker exec db pg_isready` — is the socket up?
- `df -h` on the host — named volume full?

If the database is dead but the volume is intact, a restart of the
`db` container is safe: the named volume [ADR-0001] survives.

### 2. The deploy job is green but the app is unhealthy

The deploy script polls `/api/ready` and fails the job if it doesn't
return 200. If it slipped through anyway (the deploy was made by hand
or the script was skipped):

```bash
# On the deploy host:
docker compose -p baseplate-prod -f docker/compose.prod.yaml --env-file .env ps
docker compose -p baseplate-prod -f docker/compose.prod.yaml --env-file .env logs --tail=100 api
```

Rollback as above. Then open an issue with the failing deployment's
commit SHA and the log output.

### 3. Trivy fails on an unpatchable CVE

The right answer is "open an issue and track it", not "disable the
scan". Use `.github/trivy-allowlist.yaml` with a documented justification
and an `expiry_date` (within 30 days). Past the expiry the scan fails
again — that's the discipline.

### 4. SIGTERM takes 10 seconds

If `docker stop <container>` takes the full 10-second SIGKILL timeout:

1. The container is not running a process that handles SIGTERM. Check
   that the entrypoint is the EXEC form (not the shell form).
2. The Node process is not calling `installShutdownHandlers`. Verify
   `apps/api/src/main.ts` calls it.
3. A long-running request is the expected reason for a few seconds. The
   10s hard cap is the safety net, not the normal case.

The graceful shutdown module is documented in [ADR-0007 — graceful
shutdown](#) (TODO if not yet written).

### 5. `docker compose down` lost data

The prod stack uses a named volume `pgdata`. `make down` is `docker
compose down` WITHOUT `-v`, which deletes the containers but keeps the
volume. `make prune` is the destructive one — it deletes the volume.

If a fresh volunteer ran `docker compose down -v`, the database is gone
but recoverable only from a backup. The current setup does not have
automated backups. For a hackathon, the data is the demo and the demo
can be regenerated.

## Idempotency retention

The `IdempotencyRecord` table grows monotonically. A retention sweep is
documented in [TODO — periodic cleanup query]. Suggested cadence: 30
days. Until the sweep is automated, it is a manual SQL.

## Health check endpoints

| Endpoint   | Purpose                                 | Expected status |
| ---------- | --------------------------------------- | --------------- |
| `/health`  | Liveness — is the process up?           | 200             |
| `/ready`   | Readiness — is the process usable?      | 200 / 503       |
| `/api/items` | Items endpoint (after `/api/` proxy)  | 200 / 4xx / 5xx |

Both `/health` and `/ready` return JSON. Liveness should never depend
on a dependency; readiness is allowed to.