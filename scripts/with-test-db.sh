#!/usr/bin/env bash
#
# Run a command with a disposable Postgres available on TEST_DATABASE_URL.
#
# Reuses an already-running database when there is one (fast inner loop) and
# otherwise starts a throwaway container and removes it afterwards. The same
# script is used locally and in CI, so `make test-integration` behaves
# identically in both -- which is the only way CI failures stay reproducible.
#
# Usage: with-test-db.sh <command> [args...]

set -euo pipefail

CONTAINER_NAME="baseplate-test-db"
# A non-default port so this can never collide with a dev stack or a local
# Postgres install, and can never accidentally point at real data.
HOST_PORT="${TEST_DB_PORT:-55433}"
PG_IMAGE="postgres:16.6-alpine@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef"

started_by_us=0

cleanup() {
  # Only tear down what we created. Killing a database someone else started --
  # their dev stack, or CI's `services:` container -- would be rude and slow.
  if [ "$started_by_us" = "1" ]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# In CI, a `services: postgres` container already provides the database and
# TEST_DATABASE_URL is set by the workflow. Do nothing in that case.
if [ -n "${TEST_DATABASE_URL:-}" ] && [ "${REUSE_EXISTING_TEST_DB:-1}" = "1" ]; then
  echo "  using existing TEST_DATABASE_URL"
else
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "  starting throwaway Postgres on :${HOST_PORT}"
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$CONTAINER_NAME" \
      -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=baseplate_test \
      -e POSTGRES_INITDB_ARGS='--encoding=UTF8 --locale=C' \
      -p "${HOST_PORT}:5432" \
      --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=512m \
      "$PG_IMAGE" >/dev/null
    started_by_us=1
  fi

  export TEST_DATABASE_URL="postgresql://test:test@localhost:${HOST_PORT}/baseplate_test?schema=public"

  echo -n "  waiting for Postgres"
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER_NAME" pg_isready -U test -d baseplate_test -q >/dev/null 2>&1; then
      echo " ready"
      break
    fi
    echo -n "."
    sleep 1
  done

  if ! docker exec "$CONTAINER_NAME" pg_isready -U test -d baseplate_test -q >/dev/null 2>&1; then
    echo " TIMEOUT"
    docker logs --tail=30 "$CONTAINER_NAME" || true
    exit 1
  fi
fi

# The integration suite talks to TEST_DATABASE_URL, but `prisma migrate deploy`
# reads DATABASE_URL. Pointing both at the test database is what stops a stray
# migration from touching the database you are demoing from.
export DATABASE_URL="$TEST_DATABASE_URL"

echo "  applying migrations to the test database"
pnpm --filter @baseplate/api exec prisma migrate deploy >/dev/null

echo "  running: $*"
"$@"
