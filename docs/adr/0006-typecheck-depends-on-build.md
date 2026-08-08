# ADR 0006 — typecheck depends on `^build`

## Context

In a TypeScript monorepo, `tsc --noEmit` in a downstream package needs
the declaration files that the upstream packages emit. The web app
imports `Item` from `@baseplate/contracts`; the contract package
produces `dist/index.d.ts`. Without that file, the web app's typecheck
fails — not because the types are wrong, but because the source of the
types is missing.

A "fully independent" typecheck (no `dependsOn`) sounds correct: lint
and typecheck should be independent of build. In practice, an
independent typecheck fails the first time the cache is cold, because
the declaration files don't exist yet.

## Decision

The `typecheck` task in `turbo.json` has `dependsOn: ["^build"]`. The
`build` task emits the declaration files the typecheck needs.

```json
"typecheck": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

`lint` is genuinely independent — ESLint reads source, never build
output — and stays that way.

## Consequences

- **Typecheck works on a cold cache.** The first run produces the
  declaration files; subsequent runs use the cache.
- **Typecheck is slightly slower than lint.** Acceptable: typecheck is
  the more expensive check by design (it crosses package boundaries).
- **The deviation is explicit.** A comment in `turbo.json` links to
  this ADR.
- **Build-before-typecheck is a Turbo optimisation, not a workaround.**
  The decision is documented so the next reader doesn't "fix" it.

## Alternatives rejected

- **`tsc --build` mode.** The project references mode requires
  duplication of every dependency's `path` and `composite` settings,
  and it interacts poorly with `tsc -p tsconfig.json` defaults. The
  `^build` dependency is one line.
- **Bundler-style imports.** Some bundlers can resolve TypeScript
  directly without emitted `.d.ts`. We are not using a bundler for the
  API; the API is plain Node + tsc. Adding a bundler just to fix
  typecheck is solving the wrong problem.
- **Lint-only CI.** Skipping typecheck is malpractice. The cost of
  `tsc` is small; the cost of a type bug in production is large.