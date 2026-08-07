# @opencrane/backend/server/api-spec — the one true description of the whole HTTP API

> [backend](../../../README.md) › [server](../../README.md) › api-spec

## What it owns

Every capability domain in the server (tenants, policies, grants, groups, audit, MCP, and the rest)
owns the routes for its own slice of the API and contributes a small fragment describing them. This
package is where all those fragments are **assembled into one document**: the complete **OpenAPI 3.1**
specification (OpenAPI is the standard, machine-readable way to describe an HTTP API — every path,
every request and response shape). It is the single source of truth for the API contract.

It imports each domain's path fragment (for example `_PoliciesOpenapiPaths`, `_GrantsOpenapiPaths`,
`_AuditOpenapiPaths`) and composes them, in a fixed order, alongside the shared pieces it owns
directly: the reusable schema components (tenants, policies, groups, audit entries, and so on), the
error envelope with optional field-validation issues, the pagination envelope, the security scheme,
and the cross-cutting endpoints that belong to no single domain — the auth flow (`/auth/login`,
`/auth/callback`, `/auth/me`, …) and the
`/openapi.json` document itself.

Used by the running server, which serves this document at `/openapi.json`, and by the SDK/client
generation step, which reads it to emit the typed contracts client. Editing a route means editing its
domain's fragment, then regenerating the client from this composed spec.

Invariant: the composition order is fixed on purpose — the paths are merged in a set sequence so the
serialised JSON is byte-for-byte stable, which keeps generated clients from churning on unrelated
edits. This package describes the API; it does not implement any endpoint.

## Public surface

- `spec` — the composed OpenAPI 3.1 document (`openapi`, `info`, `servers`, `components`, `security`,
  and the merged `paths`).

## Boundary

Consumed by the server's HTTP layer (served as `/openapi.json`) and by the contracts-client generator.
It only *describes* the surface; the actual handlers live in each capability domain. It sits at the
top level under `server/` — not inside any one domain group — because it must reach across all of them.

## Dependency direction

Tagged `scope:api-spec`: it may depend on `scope:shared` and on the route-owning capability scopes it
aggregates — `access-tokens`, `audit`, `awareness`, `grants`, `groups`, `mcp`, `metrics`,
`model-routing`, `policies`, `projection`, `providers`, `retrieval`, `skills`, `spend`, and `tenants`
— and never on apps. Nothing else depends on it in reverse.

## See also

- Parent index: [server](../../README.md)
- Related: [iam/policies](../../iam/policies/main/README.md) · [iam/grants](../../iam/grants/main/README.md) · [iam/audit](../../iam/audit/main/README.md)
