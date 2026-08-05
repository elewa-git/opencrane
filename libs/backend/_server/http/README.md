# @opencrane/backend/_server/http — Express transport plumbing

> [backend](../../README.md) › [_server](../README.md) › http

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
 │   _server/http  ◄── HERE                         │
 │   trusted-proxy parse → transport security →     │
 │   per-IP rate limit → (route) → error handler    │
 └────────────────────────────────────────────────┘
        │  clean request in · normalized response / error out
        ▼
 backend domain routes  ·  /healthz probe  ·  public /openapi.json
```

**In this flow:** [auth](../auth/README.md) *(authentication middleware mounted alongside)* · the
`apps/opencrane` server *(composes these into its Express app)*

It owns: a **global error handler** that turns thrown errors into consistent HTTP responses; a
`/healthz` **liveness/readiness probe** that checks the database is reachable (a probe is the small
endpoint the cluster polls to know the process is alive); a **per-IP rate limiter** (caps how many
requests one client address may make); **transport-security** middleware (security response headers);
a **trusted-proxy** parser (works out the real client IP when the server runs behind a load balancer,
so the rate limiter and logs see the true address); and a **public OpenAPI route** that serves the
API spec. Helpers take their dependencies as arguments (for example the health probe receives a
database checker), so this library never imports an app-owned Prisma package or the API spec.
Invariant: these behaviours are uniform across the server — one error shape, one rate-limit policy,
one probe — regardless of which route handles the request.

## Public surface

- `error-handler` — the global Express error-to-response handler.
- `healthz` (+ `healthz.types`) — the `/healthz` database liveness/readiness probe.
- `rate-limit` (+ `rate-limit.types`) — the per-IP fixed-window rate limiter.
- `transport-security.middleware` — security response headers.
- `trusted-proxies` (+ `trusted-proxies.types`) — real-client-IP resolution behind proxies.
- `openapi-route` — the public OpenAPI specification route.

## Boundary

Consumed by the `apps/opencrane` server, which composes these into its Express app. It provides
transport mechanics only — authentication lives in `_server/auth`, and business behaviour lives in the
backend domains. It accepts its collaborators as parameters and imports no application-owned package.

## Dependency direction

Tagged `scope:http` (`layer:infra`): it may depend only on `scope:http` and `scope:shared` packages —
never on backend domains, the frontend, or app entrypoints.

## See also

- Parent index: [_server](../README.md) · [backend libraries](../../README.md)
- Siblings: [auth](../auth/README.md) · [api](../api/README.md) · [obot-custody](../obot-custody/README.md)
