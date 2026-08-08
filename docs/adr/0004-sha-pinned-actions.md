# ADR 0004 — SHA-pinned third-party actions

## Context

GitHub Actions' default practice is `uses: actions/checkout@v4`. The
mutable tag `v4` points to whatever commit is `v4` today. Tomorrow's
identical yaml can resolve to a different commit, and the action that
shipped yesterday is not the action that runs today.

A compromised action with a mutable tag is the entire supply-chain
attack surface for a CI pipeline.

## Decision

Every third-party action is pinned to a full commit SHA. The version tag
is preserved as a trailing comment for human readers.

```yaml
# Good
uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1

# Bad
uses: actions/checkout@v4
```

Dependabot is configured to open PRs that bump the SHAs as new versions
ship.

## Consequences

- **Reproducible builds.** The action that ran the green CI run is the
  action that runs the next one.
- **A compromised action tag is detected at PR-open.** The SHA changes,
  the diff is visible, the human has to approve.
- **Comments cost nothing.** The tag is a one-line trip back to the
  release notes.
- **Bumping is a deliberate PR.** "I'll update later" is the failure
  mode; the system surfaces every old SHA.

## Alternatives rejected

- **Tag-only.** What GitHub defaults to. The supply-chain risk is
  precisely the gap.
- **Hash-only with no comment.** Loses the version tag, which means
  finding the release notes requires a `git rev-parse` lookup. The
  comment is one line.
- **Internal action proxy.** More secure, but the team is small and
  the action catalogue is short. The marginal benefit is not worth the
  marginal maintenance.