# Runbook

Everything you need to operate this stack under pressure. Cross-references
to the ADRs are in `[ADR-0001]` style.

## Deploy

The CD pipeline is the intended path. It runs on every push to `main`
after CI passes, and the `cd.yml` workflow can be re-run by hand.

```bash
# 1. Push to main.
git push origin main

# 2. Watch CI:    https://github.com/<owner>/<repo>/actions
# 3. Watch CD:    https://github.com/<owner>/<repo>/actions/workflows/cd.yml
# 4. Confirm:     curl https://<your-host>/api/ready
```

The CD workflow:
1. Builds + pushes API and web images to GHCR, tagged with BOTH
   `sha-<short-sha>` (immutable, what we deploy) and `latest` (convenience).
2. SSHes to the deploy host.
3. `docker compose pull` to fetch the new images.
4. `prisma migrate deploy` first (the running app is backward-compatible
   with the OLD schema by design — see ADR-0002).
5. `docker compose up -d` to roll the new images.
6. Polls `/api/ready` until 200 or 30 attempts.

## Rollback

The deploy references the SHA tag. Rolling back is redeploying the
previous SHA:

```bash
# On the deploy host:
docker compose -p baseplate-prod -f docker/compose.prod.yaml --env-file .env \
  pull
IMAGE_TAG=sha-abc1234 docker compose -p baseplate-prod -f docker/compose.prod.yaml \
  --env-file .env up -d
```

To find the previous SHA:

```bash
# GitHub: actions -> cd -> "build-and-push" job -> "Compute short SHA" step
# Locally:  git log --oneline -10
```

A full rollback to a specific commit is the same shape with that commit's
SHA. The `latest` tag is NOT used for rollback — it has moved.

## Break-glass merge

If GitHub Actions is unavailable and the demo is in 30 minutes:

1. Build the images locally:
   ```bash
   IMAGE_TAG=manual-$(date +%Y%m%d-%H%M%S) make prod
   ```
2. Push to GHCR from the deploy host:
   ```bash
   docker login ghcr.io
   docker push ghcr.io/<owner>/baseplate-api:manual-...
   docker push ghcr.io/<owner>/baseplate-web:manual-...
   ```
3. Deploy by hand:
   ```bash
   IMAGE_TAG=manual-... docker compose -p baseplate-prod \
     -f docker/compose.prod.yaml --env-file .env up -d
   ```
4. Comment in the PR with a one-line explanation so the audit trail is
   intact.

## Common failures

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