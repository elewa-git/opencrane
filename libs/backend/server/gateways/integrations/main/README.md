# @opencrane/backend/server/gateways/integrations — integration authority + custody

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › integrations

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external tools and models agents are allowed to use. An *integration* is one such connection to a
third-party service (say a calendar or a ticketing tool). The secret credentials for that service
are never held by OpenCrane: they live in **Obot**, an external custody service that OpenCrane
provisions and refers to by an opaque *custody reference* — a handle that stands in for the
credential without being the credential.

This package is the authority over the integration lifecycle and its custody. It runs two flows.
The **provisioning** flow (write side) asks Obot to take custody, then records a projection of the
result in Postgres. The **resolution** flow (read side) hands the server action worker an active integration
assignment for a given agent revision — a custody reference plus the exact reviewed tool definitions that revision may
call, and never any credential material.

```
 provision custody   (silo · Obot catalogue entry · write-only credential)
        │
        ▼
 ┌────────────────────────────────────┐
 │  integrations  ◄── HERE             │  Obot provisions → opaque reference; persist the projection
 └────────────────────────────────────┘        └─ persistence fails? revoke the remote custody
        │  ready custody reference (never credential bytes)
        ▼
 server action worker resolves the revision's assignment → reference + reviewed schema-bound tools
```

**In this flow:** Obot [(vendored app)](../../../../../../apps/_infra/obot/README.md) via the `@opencrane/backend/server/infra/obot-custody` port · [agent-services](../../../agents/agent-services/main/README.md) *(a revision assigns an integration)*

Invariant: Postgres is only ever a *projection* of Obot's truth. This process never invents a
custody reference — it stores only coordinates Obot confirmed, and it verifies the returned
catalogue entry, a non-empty reference, and an unexpired expiry before persisting. If persistence
fails after Obot succeeds, it revokes the remote custody so no usable-but-untracked credential is
ever left behind; if that compensating revoke also fails, it reports `compensation_failed` rather
than pretend success. Resolution returns an assignment only for an active, same-silo revision.
Failure logging is best-effort and can never flip a fail-closed result.

## Public surface

- `__ProvisionIntegrationCustody` — provision remote custody, persist the projection, compensate on
  failure.
- `PrismaIntegrationAuthorityRepository` — resolves server action assignments (read side).
- `PrismaIntegrationCustodyRepository` — persists custody projections (write side).
- `__SystemIntegrationAuthorityClock` — the production clock for custody-expiry checks.
- Types: `IntegrationAuthorityRepository`, `ResolveIntegrationAssignmentCommand`/`Result`,
  `ResolvedIntegrationAssignment`, `IntegrationCustodyRepository`,
  `ProvisionIntegrationCustodyCommand`/`Result`, `IntegrationCustodyLogger`.

## Boundary

The application layer supplies the Obot custody port, the Prisma adapters, and a logger. This
package holds no credential bytes and issues no tokens — it orchestrates Obot and keeps the Postgres
projection consistent with it.

## Dependency direction

Tagged `scope:integrations`: it may depend only on `scope:integrations`, `scope:obot-custody` (the
Obot port), `scope:agents` (the revision-owned reviewed tool-definition contract), `scope:auth`, and
`scope:shared` — never on apps or unrelated server domains. The agents dependency follows the
ownership direction: an integration resolves the exact tools already frozen into an agent
revision; it does not define or mutate that revision.

## Data & persistence

Owns `Integration` and `IntegrationCustodyReference` in
`apps/opencrane/prisma/schema/integrations.prisma`. Companion SQL authority tests live in
`tests/integrations-authority.sql`.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [mcp](../../mcp/main/README.md) · [providers](../../providers/main/README.md) · [model-routing](../../model-routing/main/README.md)
