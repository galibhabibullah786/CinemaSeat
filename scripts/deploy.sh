#!/usr/bin/env bash
#
# Deploy the prod stack to whatever host this runs on.
#
# The CD pipeline (.github/workflows/cd.yml) is the intended path -- it deploys
# an immutable sha-<short-sha> tag. This script is the same sequence, runnable
# by hand: for a local production-shaped run, and as the break-glass path when
# GitHub Actions is down. Keeping one script means the manual path cannot drift
# from the automated one.
#
# Usage:
#   scripts/deploy.sh                 # build locally and deploy
#   IMAGE_TAG=sha-abc1234 scripts/deploy.sh --pull   # deploy a published tag

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="baseplate-prod"
COMPOSE=(docker compose -p "$PROJECT" -f docker/compose.prod.yaml --env-file .env)
PULL=0
[ "${1:-}" = "--pull" ] && PULL=1

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run 'make setup' or copy .env.example." >&2
  exit 1
fi

# A caller-supplied IMAGE_TAG must WIN over the one in .env.
#
# `. ./.env` executes `IMAGE_TAG=latest` (see .env.example), which silently
# overwrites an exported IMAGE_TAG -- so `IMAGE_TAG=sha-abc1234 deploy.sh`
# would deploy `latest` instead. That is exactly the failure the immutable
# tag exists to prevent: the deploy log says sha-abc1234, the host runs
# whatever `latest` points at, and a rollback has nothing to roll back to.
IMAGE_TAG_OVERRIDE="${IMAGE_TAG:-}"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

[ -n "$IMAGE_TAG_OVERRIDE" ] && IMAGE_TAG="$IMAGE_TAG_OVERRIDE"
# Exported so compose interpolation picks it up: shell environment takes
# precedence over --env-file, which is what makes the override effective.
export IMAGE_TAG="${IMAGE_TAG:-latest}"

WEB_PORT="${WEB_PORT:-8080}"
READY_URL="http://localhost:${WEB_PORT}/api/ready"

echo "==> deploying tag '${IMAGE_TAG}'"

if [ "$PULL" = "1" ]; then
  # Pull BEFORE stopping anything: a failed pull must not leave the site down.
  #
  # --profile migrate is required: `compose pull` only touches services in
  # ENABLED profiles, so without it baseplate-migrate is never fetched and the
  # migrate step below falls back to building it from source on the production
  # host -- slow, and it would be a different artifact from the one CI scanned.
  echo "==> pulling images"
  "${COMPOSE[@]}" --profile migrate pull
else
  echo "==> building images"
  "${COMPOSE[@]}" build
fi

echo "==> starting services"
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> waiting for containers to report healthy"
bash scripts/wait-for-healthy.sh "$PROJECT" 180

# Migrations run AFTER the database is healthy and as a deliberate, separate
# step -- never implicitly at container start, where N replicas would race the
# same DDL. See docs/adr/0008.
echo "==> applying migrations"
"${COMPOSE[@]}" --profile migrate run --rm migrate

# The deploy is not "done" because containers started. It is done when the
# service answers. Without this poll, a broken release is reported as a
# successful deploy and is found by a user instead of by the pipeline.
echo "==> polling ${READY_URL}"
for attempt in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$READY_URL" || true)
  if [ "$code" = "200" ]; then
    echo "==> healthy after ${attempt} attempt(s)"
    echo ""
    echo "    web: http://localhost:${WEB_PORT}"
    exit 0
  fi
  echo "    attempt ${attempt}: ${code:-no response}"
  sleep 3
done

echo "" >&2
echo "DEPLOY FAILED: /ready did not return 200 within the timeout." >&2
echo "Rollback:  IMAGE_TAG=<previous-sha> scripts/deploy.sh --pull" >&2
echo "See docs/runbook.md." >&2
"${COMPOSE[@]}" ps >&2
"${COMPOSE[@]}" logs --tail=50 >&2
exit 1
