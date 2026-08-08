#!/usr/bin/env bash
#
# Prove the network posture of the prod stack, rather than asserting it in a
# README that drifts.
#
# Usage: verify-isolation.sh [compose-project-name]

set -uo pipefail

PROJECT="${1:-baseplate-prod}"
WEB_PORT="${WEB_PORT:-8080}"
failures=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; failures=$((failures + 1)); }

echo ""
echo "Network isolation checks for project '${PROJECT}'"
echo ""

# --- 1. Postgres must not be reachable from the host -------------------------
# Any successful TCP connect is a failure, whether or not auth succeeds.
if timeout 3 bash -c "</dev/tcp/127.0.0.1/5432" 2>/dev/null; then
  fail "Postgres is reachable on the host at 127.0.0.1:5432"
else
  pass "Postgres is NOT reachable from the host"
fi

# --- 2. The API must not be published ----------------------------------------
if timeout 3 bash -c "</dev/tcp/127.0.0.1/4000" 2>/dev/null; then
  fail "API is directly reachable on the host at 127.0.0.1:4000"
else
  pass "API is NOT directly reachable from the host"
fi

# --- 3. ...but must be reachable THROUGH nginx -------------------------------
# Proves the previous check reflects isolation rather than a dead stack.
code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${WEB_PORT}/api/health" 2>/dev/null)
if [ "$code" = "200" ]; then
  pass "API is reachable via the web tier (/api/health -> 200)"
else
  fail "API is not reachable via the web tier (/api/health -> ${code:-no response})"
fi

# --- 4. No published ports other than the web tier ---------------------------
published=$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" \
  --format '{{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0|:::' || true)
count=$(printf '%s' "$published" | grep -c . || true)
if [ "$count" -le 1 ]; then
  pass "exactly one service publishes a port"
  [ -n "$published" ] && printf '        %s\n' "$published"
else
  fail "more than one service publishes a port:"
  printf '        %s\n' "$published"
fi

# --- 5. The backend network must be internal ---------------------------------
net=$(docker network ls --format '{{.Name}}' | grep -E "^${PROJECT}_backend$" | head -1)
if [ -n "$net" ]; then
  internal=$(docker network inspect "$net" --format '{{.Internal}}' 2>/dev/null)
  if [ "$internal" = "true" ]; then
    pass "backend network is internal (no route off-host)"
  else
    fail "backend network is NOT internal"
  fi
else
  fail "backend network '${PROJECT}_backend' not found"
fi

# --- 6. Containers run as non-root -------------------------------------------
for svc in api web; do
  cid=$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" \
        --filter "label=com.docker.compose.service=${svc}" --format '{{.ID}}' | head -1)
  if [ -z "$cid" ]; then
    fail "${svc}: container not running"
    continue
  fi
  uid=$(docker exec "$cid" id -u 2>/dev/null)
  if [ -n "$uid" ] && [ "$uid" != "0" ]; then
    pass "${svc} runs as non-root (uid ${uid})"
  else
    fail "${svc} runs as root (uid ${uid:-unknown})"
  fi
done

echo ""
if [ "$failures" -eq 0 ]; then
  echo "  all isolation checks passed"
  exit 0
fi
echo "  ${failures} check(s) failed"
exit 1
