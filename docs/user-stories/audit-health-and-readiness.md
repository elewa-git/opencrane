# Audit, health, and readiness user stories

## Feature intent

Give operators bounded evidence about product actions and capability health without turning the
frontend into a Kubernetes, secret, or internal-proof console.

Current status: `API partial`, `UI missing`. Basic audit and database health exist; feature readiness,
runtime versions, and safe operator authorization need work.

## OPS-01 — Review audit events

**As an** authorised administrator, **I want** to review paginated audit events **so that** I can
trace important product and authority changes.

Acceptance criteria:

- Events show timestamp, safe actor/context, action, resource, and message.
- Pagination uses opaque cursors and preserves stable order.
- Empty, loading, unavailable, malformed-safe, long message, and end-of-history states are covered.
- Ordinary sessions cannot browse cross-user or cross-silo audit history.

API: `GET /api/v1/audit?limit=&cursor=`.

Status: `API partial`; the route currently lacks adequate role/silo enforcement.

## OPS-02 — See basic service health

**As an** operator, **I want** to know whether the public server and database are healthy **so that**
I can distinguish application outage from authentication or feature failure.

Acceptance criteria:

- Basic health distinguishes server unavailable, server ready/database ready, and database failure.
- The public response reveals no credentials, connection strings, topology, or internal error detail.
- Product UI does not equate database health with full product readiness.

API: public `GET /healthz`.

## OPS-03 — Understand feature capability readiness

**As an** organisation or deployment operator, **I want** a safe readiness matrix **so that** I know
which journeys are configured, available, degraded, or deliberately disabled.

Acceptance criteria:

- The projection covers OIDC, membership, LiteLLM, model routing, Obot custody, MCP invocation,
  agent controller, scheduler, artifact preprocessing, memory gateway, and admission capacity.
- States distinguish absent/disabled, configured, ready, degraded, and unavailable.
- Configuration existence is never used as proof of executable readiness.
- The response exposes no raw secrets, token paths, ServiceAccounts, Pod IDs, proof keys, or internal
  network coordinates.

Status: `API blocked`; no consolidated public readiness endpoint exists.

## OPS-04 — Inspect runtime and product versions

**As an** operator, **I want** to see safe server, UI, runtime, protocol, and deployment versions **so
that** I can correlate a reported problem with the deployed release.

Acceptance criteria:

- Versions are immutable build/release identifiers, not mutable image tags alone.
- Missing and incompatible component versions are visible without leaking cluster internals.

Status: `API blocked`; Phase F names runtime versions, but no public version projection exists.

## OPS-05 — Use the API contract as a reliable client source

**As a** frontend or integration developer, **I want** the published OpenAPI to match mounted routes,
authentication, schemas, and response codes **so that** generated clients are safe to implement.

Acceptance criteria:

- All mounted product operations are represented.
- Cookie-session security and public exceptions are declared correctly.
- Persona mutations, managed-agent mutations, integration custody, and token usage are included.
- Group, MCP registry, third-party-source, and budget schemas match runtime behaviour.
- Generated TypeScript contracts are refreshed and diff-checked from the canonical spec.

Current evidence: the generated contract has 82 operations while the mounted `/api/v1` surface has
104. `GET /api/v1/openapi.json` is authenticated in route assembly even though the contract says it
is public.
