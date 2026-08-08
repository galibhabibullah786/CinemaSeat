# AGENTS.md — canonical agent instructions for this repo

This is the **only** canonical instruction file. The repo-root `AGENTS.md`,
`CLAUDE.md`, and `.cursor/rules/agents.md` are 5-line pointers to this file.
Drift between agent files is the failure mode we are designing out — keep it
that way.

## Stack

- Node 20+ (see `.nvmrc`), TypeScript strict, pnpm workspaces, Turborepo.
- API: Express 4 + Prisma 6 + PostgreSQL 16. Validation: zod. Logger: pino.
- Web: React 18 + Vite + TypeScript. One typed client for all API access.
- Containers: multi-stage Dockerfiles, Compose for dev and prod.
- CI/CD: GitHub Actions → GHCR → deploy over SSH. Path-filtered, fork-safe.
- Tests: vitest (unit + integration), Playwright (e2e). Supertest for HTTP.

## Directory map

```
apps/api/                Express API. Layered: routes -> handler -> service -> repo -> Prisma.
apps/web/                React + Vite SPA. All API access through src/api/client.ts.
packages/contracts/      Zod schemas -> shared DTO types. Imported by BOTH api and web.
packages/logger/         Pino + AsyncLocalStorage context + traceparent parse/build.
packages/config/         Shared tsconfig / eslint / prettier. Apps extend it.
e2e/                     Playwright. Runs against compose.prod on :8080.
docker/                  Dockerfiles + compose files. No application code here.
docs/                    ADRs, runbook, standards.
scripts/                 Shell scripts that are part of the developer workflow.
.github/workflows/       CI, CD, debug.
.agents/skills/          Domain-specific checklists for an LLM agent.
```

## Commands

| Need              | Command                                                  |
| ----------------- | -------------------------------------------------------- |
| Install           | `make setup`                                             |
| Dev stack         | `make dev`                                               |
| Production stack  | `make prod`                                              |
| Stop stack        | `make down`                                              |
| Lint              | `make lint`                                              |
| Typecheck         | `make typecheck`                                         |
| Build             | `make build`                                             |
| Unit tests        | `make test-unit`                                         |
| Integration tests | `make test-integration`                                  |
| E2E tests         | `make e2e` (requires `make prod` running)                |
| All CI gates      | `make ci-local`                                          |
| Deploy            | `make deploy`                                            |
| Hackathon start   | `make reset-domain`                                      |
| Help              | `make help`                                              |

## Git workflow

- One branch per change. Conventional commits (`feat:`, `fix:`, `chore:`).
- PR to `main` triggers CI. Do not merge unless CI is green.
- Squash-merge on PR. Linear history on main.
- Keep commits small. One logical change per commit.

## Code conventions

- Strict TypeScript. `noUncheckedIndexedAccess` is on.
- ESLint flat config. Zero warnings in `pnpm run lint`.
- Errors are typed (`AppError` subclasses in `apps/api/src/domain/errors.ts`).
- Every invariant is enforced at the lowest layer that can enforce it.
- Optional chaining + explicit fallbacks at boundaries that can fail.
- Shared types live in `packages/contracts`. NEVER redeclare a DTO.
- Do not delete a test to make faulty code pass. Fix the code.

## Definition of done

A change is done when:

1. The slice is vertical: contract → API → web → test → container → pipeline.
2. `make ci-local` is green locally.
3. New behaviour has tests at the right layer (see `.agents/skills/testing.md`).
4. No new warning in lint, typecheck, or audit.
5. ADRs are updated when a non-obvious decision changed.
6. The README or runbook reflects any user-visible change.
7. Secrets are never committed and never reach a Docker layer.

## For an LLM agent working in this repo

1. Read `.agents/AGENTS.md` (this file) for orientation.
2. Read the relevant skill file in `.agents/skills/` BEFORE editing code.
3. Read ONLY the files you need for the current task.
4. At each phase boundary, output a ≤10-line state summary.
5. Match existing patterns. Consistency beats local cleverness.
6. When in doubt, ask. Don't guess about boundaries between packages.

## Skills

- `.agents/skills/correctness-and-concurrency.md`
- `.agents/skills/security.md`
- `.agents/skills/performance-and-scale.md`
- `.agents/skills/testing.md`
- `.agents/skills/observability.md`