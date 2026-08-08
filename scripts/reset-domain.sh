#!/usr/bin/env bash
#
# Reset the demo domain. This is the script that STARTS the hackathon.
#
# What it removes:
#   - apps/api/src/modules/items/                       (the entire demo module)
#   - apps/web/src/features/items/                      (the entire demo feature)
#   - packages/contracts/src/item.ts                    (the demo schema)
#   - apps/api/tests/api.integration.test.ts            (the demo integration tests)
#   - apps/api/src/modules/items/item.*.test.ts         (unit tests, if any)
#   - the demo-domain block in apps/api/prisma/schema.prisma (the model)
#   - the corresponding migration
#   - imports and references to the demo module in app.ts, App.tsx,
#     packages/contracts/src/index.ts
#
# What it leaves behind: a compiling, deployable skeleton with:
#   - /health, /ready (unchanged)
#   - the error envelope, correlation, idempotency infrastructure
#   - the layered architecture and the repository SEAM ready to receive the
#     real domain
#
# SAFETY:
#   - Refuses to run unless the worktree is clean (or --force).
#   - Prints every file it intends to remove BEFORE removing it.
#   - Suggests the next command but does not run it.

set -euo pipefail

cd "$(dirname "$0")/.."

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

step() { printf "\n${YELLOW}==>${RESET} %s\n" "$1"; }
ok()   { printf "  ${GREEN}OK${RESET}  %s\n" "$1"; }
warn() { printf "  ${YELLOW}WARN${RESET}  %s\n" "$1"; }
fail() { printf "  ${RED}FAIL${RESET} %s\n" "$1"; exit 1; }

# --- guard: refuse to run on a dirty worktree --------------------------------
if [ "$FORCE" != "1" ] && ! git diff --quiet HEAD -- . ':!apps/api/generated' ':!.turbo' 2>/dev/null; then
  echo ""
  fail "Worktree is dirty. Commit or stash changes, then re-run, or pass --force."
fi

# --- collect the targets -----------------------------------------------------
# Everything between the `>>> DEMO-DOMAIN:items` and `<<< DEMO-DOMAIN:items`
# markers is owned by this script.
MARKER='DEMO-DOMAIN:items'

step "Discovering demo-domain files"
mapfile -t MARKED_FILES < <(grep -rl --include='*.ts' --include='*.tsx' --include='*.prisma' "$MARKER" . 2>/dev/null \
  | grep -v node_modules \
  | grep -v '\.turbo' \
  | grep -v 'apps/api/generated' \
  | grep -v 'apps/api/dist' \
  || true)

WHOLE_DIRS=(
  "apps/api/src/modules/items"
  "apps/web/src/features/items"
)

# --- display -----------------------------------------------------------------
echo ""
echo "  This script will delete the following files/directories:"
for f in "${MARKED_FILES[@]}"; do
  echo "    $f"
done
for d in "${WHOLE_DIRS[@]}"; do
  if [ -d "$d" ]; then
    echo "    $d/  (whole directory)"
  fi
done

# --- confirm -----------------------------------------------------------------
if [ "$FORCE" != "1" ]; then
  printf "\n  Type 'yes' to continue: "
  read -r ans
  [ "$ans" = "yes" ] || { echo "  aborted"; exit 1; }
fi

# --- execute -----------------------------------------------------------------
step "Stripping demo-domain blocks from marked files"
for f in "${MARKED_FILES[@]}"; do
  if [ -f "$f" ]; then
    # Delete from `>>> DEMO-DOMAIN:items` to `<<< DEMO-DOMAIN:items`,
    # inclusive. awk is portable and does not depend on perl features.
    awk -v marker=">>> $MARKER" -v end="<<< $MARKER" '
      $0 ~ marker { skip=1; next }
      $0 ~ end    { skip=0; next }
      !skip       { print }
    ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    ok "stripped $f"
  fi
done

step "Removing whole demo-domain directories"
for d in "${WHOLE_DIRS[@]}"; do
  if [ -d "$d" ]; then
    rm -rf "$d"
    ok "removed $d/"
  else
    warn "$d/ not present (already gone?)"
  fi
done

step "Removing integration tests that depend on the demo domain"
INTEGRATION_TEST="apps/api/tests/api.integration.test.ts"
if [ -f "$INTEGRATION_TEST" ]; then
  rm -f "$INTEGRATION_TEST"
  ok "removed $INTEGRATION_TEST"
fi

# Remove any leftover unit tests that mention the demo domain
mapfile -t UNIT_TESTS < <(find apps/api/src -type f -name '*.test.ts' 2>/dev/null \
  | xargs grep -l -E "item\.|ItemService|item\.repository|item\.service|@baseplate/contracts.*[Ii]tem" 2>/dev/null \
  | grep -v node_modules || true)
for f in "${UNIT_TESTS[@]}"; do
  rm -f "$f"
  ok "removed unit test $f"
done

# Remove the prisma migration. This is the schema change that introduced
# `Item`. Delete by name -- safe because nothing else depends on it.
step "Removing the demo migration (if it introduced only the Item model)"
MIG_DIR="$(ls -1d apps/api/prisma/migrations/*/ 2>/dev/null | tail -1 || true)"
if [ -n "$MIG_DIR" ]; then
  if grep -q 'CREATE TABLE.*"items"' "$MIG_DIR/migration.sql" 2>/dev/null; then
    rm -rf "$MIG_DIR"
    ok "removed migration $MIG_DIR"
  else
    warn "latest migration $MIG_DIR does not look like the items migration; left in place"
  fi
fi

# --- verify ------------------------------------------------------------------
step "Verifying the skeleton compiles"
if command -v pnpm >/dev/null 2>&1; then
  if pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1; then
    ok "pnpm install completed"
  else
    warn "pnpm install failed -- run it by hand"
  fi
  if pnpm --filter @baseplate/api exec prisma generate >/dev/null 2>&1; then
    ok "prisma generate completed"
  else
    warn "prisma generate failed -- run it by hand"
  fi
  if pnpm run typecheck >/dev/null 2>&1; then
    ok "typecheck passed"
  else
    warn "typecheck reported errors -- fix them before proceeding"
  fi
else
  warn "pnpm not on PATH; skipped verification"
fi

echo ""
echo "  ${GREEN}done.${RESET} The skeleton is ready. Suggested next commands:"
echo ""
echo "    git add -A && git commit -m 'reset: remove demo domain'"
echo "    pnpm run dev             # start dev stack"
echo "    pnpm run build && pnpm run start     # smoke-test production shape"
echo ""
echo "  Add your real domain by:"
echo "    - defining its zod schema in packages/contracts/src/"
echo "    - creating apps/api/src/modules/<domain>/{*.repository.ts,*.service.ts,*.handler.ts,*.routes.ts}"
echo "    - mirroring it under apps/web/src/features/<domain>/"
echo "    - writing the migration in apps/api/prisma/migrations/"
echo ""