# Security

**Trigger:** any code that accepts input, authenticates a user, authorises an
action, or stores data.

## Checklist

### Authn
- [ ] Authentication is a SEPARATE concern from authorisation.
- [ ] Tokens are verified cryptographically (signature, expiry, audience).
- [ ] Token verification happens at the LOWEST layer that can do it (route
      or middleware), so an unauthenticated request can never reach a handler.

### Authz
- [ ] Every handler asks "is this user allowed to do this on this resource?".
      A 401 (no auth) and a 403 (auth, but not allowed) are different.
- [ ] Tenant scoping is in the REPOSITORY, not in the handler. Handlers
      forget; the database always sees the query.
- [ ] 404, not 403, when a resource exists but the caller cannot see it.
      403 confirms the id is real — the read primitive of an enumeration
      attack.

### IDOR / BOLA
- [ ] Test: "user A cannot read user B's resource by changing the id".
- [ ] Authorisation is per-resource, not per-route. A single check at the
      router is not enough.

### Input validation
- [ ] EVERY external input has a schema. `req.body`, `req.query`, `req.params`,
      headers, environment variables, queue message bodies.
- [ ] The schema lives in `packages/contracts`. It is the SAME schema on
      both sides of the network.
- [ ] `.strict()` on object schemas. A typo'd field name should be a 400,
      not a silently dropped value.
- [ ] `z.coerce.number()` for query strings; `z.string().datetime()` for
      timestamps from clients.
- [ ] Path params are validated as UUIDs before they reach the database.
      A bad UUID is a 400, not a Postgres error surfaced as a 500.

### Secret handling
- [ ] No secret in the codebase. Use environment variables, never constants.
- [ ] `.env` is gitignored. `.env.example` has only safe defaults.
- [ ] No secret in a Docker image layer. `docker save` reveals everything.
- [ ] The build does not log secrets. Pino `redact: [...]` covers
      authorization, cookies, password, token. Verify with `grep`.
- [ ] A secret rotation plan is in the runbook.

### JWT pitfalls
- [ ] Pin the algorithm. `alg: 'none'` and `alg: 'HS256'` with a public key
      are the classics.
- [ ] Validate `typ` is `JWT`. Reject `JWT+...` and other extensions.
- [ ] Validate `iss`, `aud`, `exp`, `nbf`. All of them.
- [ ] For revocation, a stateless JWT is the wrong tool. Either accept the
      staleness window (and document it) or store a revocation list.

### Defence in depth
- [ ] At least three layers fail closed if the same input is bad.
- [ ] The web tier has CSP, X-Frame-Options, Referrer-Policy. The API
      tier has helmet with content security policy off (no document to
      protect).
- [ ] CORS is an explicit allowlist. NEVER `*`. NEVER trust the Origin header
      without validating against the allowlist.
- [ ] `trust proxy` is set to the EXACT number of trusted hops. `true`
      lets any client forge X-Forwarded-For.

### Per-feature attack vector enumeration
- [ ] For every endpoint, write down the top three ways it could be misused:
      enumeration, brute force, replay, injection, denial of service.
- [ ] Each one has a counter-measure in the implementation, or is explicitly
      out of scope with a documented reason.

### Injection
- [ ] SQL: only via the query builder or a parameterised query. Never
      string-concatenated user input.
- [ ] NoSQL: never pass user input directly as the query shape. An
      unvalidated `req.body` becomes an attacker-controlled operator.
- [ ] HTML: anything that ends up in a browser is either auto-escaped by
      the framework or written through a sanitiser. Never `innerHTML = user`.

### Rate limiting & abuse
- [ ] Writes are rate-limited. Reads are cheap; limiting them breaks the
      web app's polling.
- [ ] Rate limiter key includes the verified user id, not just the IP.
- [ ] In-process limiters are documented as per-process. Multi-replica
      deployments move to Redis.

### Logging hygiene
- [ ] No PII in logs (emails, names, ids, addresses).
- [ ] No credentials, ever. Redact `authorization`, `cookie`, `password`,
      `token`, `secret`, `key`.
- [ ] No full request bodies. Length is fine, content is not.

### Threat-model template

For each new feature, answer in the PR description:

1. What are the untrusted inputs?
2. What does an attacker control?
3. What's the worst case if a request is replayed / delayed / mutated?
4. Is there an idempotency / lockout / rate-limit story?

If you can't answer these, the feature isn't ready for review.