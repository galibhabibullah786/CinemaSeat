# Git workflow

## Branching

- `main` is always deployable. CI is green on `main`.
- One branch per change. Short names: `fix-bad-uuid-validation`,
  `feat-add-bearer-auth`. No `john/feature` style — branches are not
  ownership tags.
- Branch from a fresh `main`. If `main` has moved, rebase.

## Commits

- One logical change per commit. Don't bundle a refactor with a bug
  fix.
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`,
  `refactor:`, `perf:`.
- Imperative mood: "Add", not "Added". Lowercase first letter after
  the type.
- Body explains WHY, not what. The diff shows what.

## Pull requests

- PRs to `main` trigger CI. The PR template asks "what does this change
  and why".
- The PR description is the audit trail. Add a one-line summary plus
  any context a future reader needs.
- Squash-merge on PR. Linear history on `main`. Each commit on `main`
  represents a deployable state.

## Pre-commit

- `make ci-local` runs lint, typecheck, build, and tests. Run it before
  pushing; CI is the same gates with longer timeouts.
- A failing test is never edited to make faulty code pass. See
  `.agents/skills/testing.md`.

## Releases / tags

- The CD pipeline tags releases with `sha-<short-sha>`. There is no
  manual tagging step.
- A version like `v1.2.3` is a manual process for after the hackathon.
  For the hackathon, the SHA tag is the release.