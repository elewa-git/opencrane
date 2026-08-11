# @opencrane/backend/server/infra/http — Express transport plumbing

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › http

## What it owns

This library holds the **HTTP transport plumbing** the OpenCrane server wraps around its routes —
the cross-cutting pieces every web request needs but no single feature owns. It is built on Express
(the Node.js web framework), and it deliberately holds no business logic.

It supplies the outer layers of the request pipeline:

```
 incoming HTTP request
        │
        ▼
 ┌────────────────────────────────────────────────┐
 │   server/infra/http  ◄── HERE                         │
 │   trusted-proxy parse → transport security →     │
 │   rate limit → auth → validation → route → error │
 └────────────────────────────────────────────────┘
        │  clean request in · normalized response / error out
        ▼
 backend domain routes  ·  /healthz probe  ·  public /openapi.json
```

**In this flow:** [auth](../auth/README.md) *(authentication middleware mounted alongside)* · the
`apps/opencrane` server *(composes these into its Express app)*

It owns: a **global error handler** that turns thrown errors into consistent HTTP responses; a
Zod-backed **public request-body wrapper** that hands parsed models to authorized route handlers and
returns bounded, form-mappable field issues; a sanitized malformed-JSON response that never logs the
raw caller body; a sanitized payload-too-large response that honours each route's byte ceiling
without logging retained caller bytes; a `/healthz` **liveness/readiness probe** that checks the database is reachable (a
probe is the small endpoint the cluster polls to know the process is alive); a **per-IP rate limiter** (caps how many
requests one client address may make); **transport-security** middleware (security response headers);
a **trusted-proxy** parser (works out the real client IP when the server runs behind a load balancer,
so the rate limiter and logs see the true address); and a **public OpenAPI route** that serves the
API spec. Helpers take their dependencies as arguments (for example the health probe receives a
narrow typed checker that performs request-bearing I/O on every call), so this library never imports an app-owned Prisma package,
executes raw queries, or imports the API spec.
Invariant: these behaviours are uniform across the server — one error shape, one rate-limit policy,
one probe — regardless of which route handles the request.

## Public surface

- `error-handler` — the global Express error-to-response handler.
- `___WithValidatedPublicBody` — validates an authorized public JSON body and forwards a parsed
  model, or emits bounded `{ location, path, message }` issues.
- `healthz` (+ `healthz.types`) — the `/healthz` database liveness/readiness probe.
- `rate-limit` (+ `rate-limit.types`) — the per-IP fixed-window rate limiter.
- `transport-security.middleware` — security response headers.
- `trusted-proxies` (+ `trusted-proxies.types`) — real-client-IP resolution behind proxies.
- `openapi-route` — the public OpenAPI specification route.

## Boundary

Consumed by the `apps/opencrane` server, which composes these into its Express app. It provides
transport mechanics only — authentication lives in `server/infra/auth`, and business behaviour lives in the
backend domains. It accepts its collaborators as parameters and imports no application-owned package.
Authorization middleware must be mounted before public validation whenever field diagnostics could
disclose a protected contract. Internal workload validators remain opaque and are not automatically
converted into browser-visible validation failures.

## Dependency direction

Tagged `scope:http` (`layer:infra`): it may depend only on `scope:http` and `scope:shared` packages —
never on backend domains, the frontend, or app entrypoints.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [auth](../auth/README.md) · [api](../api/README.md) · [obot-custody](../obot-custody/README.md)
