# Simplify

**Trigger:** after writing a non-trivial change, before declaring the
change done. Catches reuse, quality, and efficiency regressions that
the first pass missed.

## When to run

- After a code change lands in the working tree but before commit.
- After a refactor that touches more than one file.
- After a CI/CD, infra, or config change where drift between similar
  blocks is the typical failure mode.

The skill is cheap to run; the cost of skipping it is the bug that
lands in `main` because nobody asked "did I reinvent something that
already exists?".

## Phase 1 — Identify changes

```bash
git status
git diff --stat
git diff HEAD   # or git diff if there are no staged changes
```

If there are no git changes, review the most recently modified files
the user mentioned or that you edited earlier in this conversation.
Do NOT skip the review because "nothing changed" — staged-but-unread
diffs are the failure mode.

## Phase 2 — Launch three review agents in parallel

Use the Agent tool (`general-purpose` subagent) to launch all three
agents concurrently in a single message. Pass each agent the full
diff so it has the complete context. Parallel execution is the
optimisation: the three reviews take about as long as one.

### Agent 1 — Code Reuse

For each change:

1. **Search for existing utilities and helpers** that could replace
   newly written code. Look for similar patterns elsewhere in the
   codebase — common locations are utility directories, shared
   modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.**
   Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** —
   hand-rolled string manipulation, manual path handling, custom
   environment checks, ad-hoc type guards, and similar patterns are
   common candidates.

### Agent 2 — Code Quality

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached
   values that could be derived, observers/effects that could be
   direct calls.
2. **Parameter sprawl**: adding new parameters to a function instead
   of generalizing or restructuring existing ones.
3. **Copy-paste with slight variation**: near-duplicate code blocks
   that should be unified with a shared abstraction.
4. **Leaky abstractions**: exposing internal details that should be
   encapsulated, or breaking existing abstraction boundaries.
5. **Stringly-typed code**: using raw strings where constants, enums
   (string unions), or branded types already exist in the codebase.
6. **Unnecessary comments**: comments explaining WHAT the code does
   (well-named identifiers already do that), narrating the change,
   or referencing the task/caller — delete; keep only non-obvious
   WHY (hidden constraints, subtle invariants, workarounds).

### Agent 3 — Efficiency

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads,
   duplicate network/API calls, N+1 patterns.
2. **Missed concurrency**: independent operations run sequentially
   when they could run in parallel.
3. **Hot-path bloat**: new blocking work added to startup or
   per-request/per-render hot paths.
4. **Recurring no-op updates**: state/store updates inside polling
   loops, intervals, or event handlers that fire unconditionally —
   add a change-detection guard so downstream consumers aren't
   notified when nothing changed.
5. **Unnecessary existence checks**: pre-checking file/resource
   existence before operating (TOCTOU anti-pattern) — operate
   directly and handle the error.
6. **Memory**: unbounded data structures, missing cleanup, event
   listener leaks.
7. **Overly broad operations**: reading entire files when only a
   portion is needed, loading all items when filtering for one.

## Phase 3 — Fix issues

Wait for all three agents to complete. Aggregate their findings and
fix each issue directly. If a finding is a false positive or not
worth addressing, note it and move on — do not argue with the
finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was
already clean). The summary goes to the user; the diff is in git.

## Failure modes

- **Skipping the parallel launch.** Running the three agents
  sequentially triples the wall-clock cost for no benefit. Always
  fan out.
- **Editing instead of reviewing.** Agents are not there to "fix
  things"; they are there to surface issues. The agent output is a
  review, not a patch.
- **Looping on false positives.** If an agent flags something that is
  actually correct (e.g. "duplicate code" that is two unrelated
  build-push steps with different contexts), skip it without arguing.
  Argue in your own head, not in the response.
