#!/usr/bin/env bash
#
# Block until every container in a compose project reports healthy, or fail.
#
# Why this exists: `docker compose up -d` returns as soon as containers are
# CREATED, not when they are usable. Scripting anything after it -- migrations,
# a smoke test, a Playwright run -- without waiting produces a flaky failure
# that looks like a bug in the thing you were testing.
#
# Usage: wait-for-healthy.sh <compose-project-name> [timeout-seconds]

set -euo pipefail

PROJECT="${1:?usage: wait-for-healthy.sh <compose-project-name> [timeout-seconds]}"
TIMEOUT="${2:-120}"

deadline=$(( SECONDS + TIMEOUT ))

# Containers without a HEALTHCHECK report no status at all. Treating that as
# "unhealthy" would hang forever; treating it as "healthy" is correct, because
# we have no better signal than "running".
while true; do
  ids=$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.ID}}')

  if [ -z "$ids" ]; then
    echo "  no running containers for project '${PROJECT}' yet..."
  else
    pending=""
    failed=""

    for id in $ids; do
      name=$(docker inspect --format '{{.Name}}' "$id" | sed 's|^/||')
      # `.State.Health` is absent when the image declares no healthcheck.
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
      running=$(docker inspect --format '{{.State.Running}}' "$id")

      case "$status" in
        healthy)   ;;
        none)      [ "$running" = "true" ] || failed="${failed} ${name}(exited)" ;;
        unhealthy) failed="${failed} ${name}(unhealthy)" ;;
        *)         pending="${pending} ${name}(${status})" ;;
      esac
    done

    # Fail fast on a definitively broken container rather than burning the
    # whole timeout on something that will never recover.
    if [ -n "$failed" ]; then
      echo "  FAILED:${failed}"
      echo ""
      echo "  --- recent logs ---"
      docker compose -p "$PROJECT" logs --tail=40 2>/dev/null || true
      exit 1
    fi

    if [ -z "$pending" ]; then
      echo "  all containers healthy"
      exit 0
    fi

    echo "  waiting for:${pending}"
  fi

  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "  TIMEOUT after ${TIMEOUT}s"
    docker compose -p "$PROJECT" ps 2>/dev/null || true
    docker compose -p "$PROJECT" logs --tail=40 2>/dev/null || true
    exit 1
  fi

  sleep 2
done
