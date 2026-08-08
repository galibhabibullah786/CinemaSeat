# =============================================================================
#  Hackathon baseplate -- one entry point for every routine action.
#
#  Why a Makefile and not just pnpm scripts: half of these commands are docker
#  compose invocations with -f/-p/--env-file flags that nobody will remember
#  correctly at 3am. `make help` is the interface.
# =============================================================================

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# Reject silent no-ops caused by a stray file named like a target.
.PHONY: help setup dev dev-detached prod down logs test test-unit test-integration \
        e2e lint typecheck build ci-local deploy migrate verify-isolation \
        reset-domain clean prune ps

# --- configuration -----------------------------------------------------------
PROJECT      := baseplate
COMPOSE_DEV  := docker compose -p $(PROJECT)-dev  -f docker/compose.dev.yaml  --env-file .env
COMPOSE_PROD := docker compose -p $(PROJECT)-prod -f docker/compose.prod.yaml --env-file .env
PNPM         := pnpm

# --- help --------------------------------------------------------------------
help: ## Show this help
	@echo ""
	@echo "  Hackathon baseplate"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""

# --- one-time setup ----------------------------------------------------------
setup: ## Install deps, create .env from the example, generate the Prisma client
	@command -v pnpm >/dev/null 2>&1 || { \
		echo "pnpm not found. Either 'devbox shell' (recommended -- pins node+pnpm+act+psql),"; \
		echo "or: corepack enable && corepack prepare pnpm@9.15.3 --activate"; \
		exit 1; }
	@if [ ! -f .env ]; then cp .env.example .env; echo "  created .env from .env.example"; \
	 else echo "  .env already exists -- left untouched"; fi
	$(PNPM) install --frozen-lockfile || $(PNPM) install
	$(PNPM) --filter @baseplate/api exec prisma generate
	@echo "  setup complete. Next: make dev"

# --- development -------------------------------------------------------------
dev: ## Start Postgres + API + web with hot reload (foreground, Ctrl-C to stop)
	$(COMPOSE_DEV) up --build

dev-detached: ## Same as `dev` but in the background
	$(COMPOSE_DEV) up --build -d

# --- production-shaped local stack -------------------------------------------
prod: ## Build and run the full production stack locally (web on $$WEB_PORT)
	$(COMPOSE_PROD) up --build -d
	@echo "  waiting for the stack to become healthy..."
	@bash scripts/wait-for-healthy.sh $(PROJECT)-prod
	$(MAKE) migrate
	@echo "  stack is up. web: http://localhost:$${WEB_PORT:-8080}"

migrate: ## Apply Prisma migrations against the running prod stack
	$(COMPOSE_PROD) --profile migrate run --rm migrate

verify-isolation: ## Assert Postgres/API are unreachable from the host (criterion 4)
	@bash scripts/verify-isolation.sh $(PROJECT)-prod

down: ## Stop both stacks, KEEPING the database volume
	-$(COMPOSE_DEV) down --remove-orphans
	-$(COMPOSE_PROD) --profile migrate down --remove-orphans
	@echo "  stopped. Postgres data survives in the named volume (use 'make prune' to destroy it)."

logs: ## Tail logs from the prod stack (SERVICE=api to narrow)
	$(COMPOSE_PROD) logs -f --tail=200 $(SERVICE)

ps: ## Show container status for both stacks
	-$(COMPOSE_DEV) ps
	-$(COMPOSE_PROD) ps

# --- quality gates -----------------------------------------------------------
lint: ## ESLint across the workspace
	$(PNPM) run lint

typecheck: ## tsc --noEmit across the workspace
	$(PNPM) run typecheck

build: ## Build every package and app
	$(PNPM) run build

test: test-unit test-integration ## Unit + integration tests

test-unit: ## Unit tests only (no database required)
	$(PNPM) run test:unit

test-integration: ## Integration tests against a real Postgres from compose
	@bash scripts/with-test-db.sh $(PNPM) run test:integration

e2e: ## Playwright end-to-end suite against the compose.prod stack
	$(PNPM) --filter @baseplate/e2e run test

ci-local: ## Run the same gates CI runs, in the same order, locally
	$(MAKE) lint
	$(MAKE) typecheck
	$(MAKE) build
	$(MAKE) test
	@echo "  local CI gates passed"

# --- deploy ------------------------------------------------------------------
deploy: ## Deploy to the configured host (see docs/runbook.md); prefers the CD pipeline
	@bash scripts/deploy.sh

# --- hackathon start ---------------------------------------------------------
reset-domain: ## Delete the demo "items" domain, leaving a compiling skeleton
	@bash scripts/reset-domain.sh

# --- cleanup -----------------------------------------------------------------
clean: ## Remove build output, caches and node_modules
	$(PNPM) run clean || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules e2e/node_modules
	rm -rf apps/*/dist packages/*/dist .turbo apps/*/.turbo packages/*/.turbo
	rm -rf coverage apps/*/coverage e2e/playwright-report e2e/test-results

prune: ## DESTRUCTIVE: stop everything and delete the database volume
	@printf "  This deletes all local database data. Type 'yes' to continue: " && read ans && [ "$$ans" = "yes" ]
	-$(COMPOSE_DEV) down -v --remove-orphans
	-$(COMPOSE_PROD) down -v --remove-orphans
