# Code conventions

## TypeScript

- Strict mode. `noUncheckedIndexedAccess` is on. `strict: true`.
- Never use `any` outside generated code. Use `unknown` and narrow.
- Optional chaining (`?.`) and explicit fallbacks at every boundary
  that can be absent: env vars, network calls, JSON parsing, array
  access, DB results.
- Every async function has an explicit return type at the public
  boundary.

## Imports

- ES modules (`type: "module"` in package.json). Use `.js` extensions in
  TypeScript imports (the emit-style fix).
- Workspace dependencies use `workspace:*`.
- No `import * as ...`. Named imports only.

## Errors

- Errors are typed. `AppError` subclasses in `apps/api/src/domain/errors.ts`.
- The service throws; the transport (HTTP) maps to status codes. The
  service does not know what 404 is.
- Never swallow an error. Log it with a request id.

## Comments

- Comments explain WHY, not what. The code shows what.
- Header comments document non-obvious decisions. Keep them short.
- A `// Why: ...` line above a tricky line is worth its weight.

## File layout

- One module per file. The file's name is the module's primary export.
- Group related modules in a directory. `apps/api/src/modules/items/`
  contains everything about items.

## Style

- Prettier is the authority. `make format` or `pnpm run format`.
- ESLint is the authority. `make lint`.
- Both run in CI. A failing lint is a failing build.