# @opencrane/backend/agents/memory — durable fact catalogue

> [backend](../../../README.md) › [agents](../../README.md) › [memory](../README.md) › main

## What it owns

This package owns the generic metadata record for a durable agent-memory fact. Cognee is the only
place that retains the fact's text; after Cognee accepts it, this package records the dataset,
gateway identifier, content digest, consent, sensitivity, provenance, and a matching outbox intent.
That makes facts explainable and correctable without creating a second content store.

```
 Cognee accepts fact text
          │ gateway id + digest + consent + provenance
          ▼
 ┌───────────────────────────────┐
 │     agent memory  ◄── HERE     │  metadata + outbox commit together
 └───────────────────────────────┘
          │
          ▼
 PostgreSQL catalogue and pending event
```

**In this flow:** [personal memory](../../personal/memory/main/README.md) selects a verified
personal dataset; the [memory gateway](../../../../server/_infra/memory-gateway-client/README.md)
owns all fact-content reads and writes.

The invariant is strict: a row can never contain fact text, and a catalog row cannot commit without
its matching outbox intent. This authority is deliberately not production-composed yet: there is no
writer or outbox dispatcher in the current application. The package and database constraints remain
as dormant groundwork; they do not mean personal memory retention is live.

## Public surface

- `__RecordMemoryFact(unitOfWork, command)` — validates content-free fact evidence and commits it
  through one unit of work.
- `PrismaMemoryCatalogUnitOfWork` — transaction adapter with bounded serialization retries and
  post-rollback uniqueness resolution.
- `PrismaMemoryCatalogRepository` — transaction-scoped metadata and outbox repository.
- `MemoryCatalogUnitOfWork` / `MemoryCatalogRepository` — ports for the atomic persistence boundary.

## Boundary

The future authenticated server composition will consume this package only after the memory gateway
has returned durable acceptance evidence. It never calls Cognee, selects an identity scope, or
dispatches an event. A gateway failure must therefore happen before catalog persistence, not be
silently represented as an empty or fabricated memory result.

## Dependency direction

Tagged `scope:memory`, this backend package may depend only on `scope:artifacts`, `scope:memory`,
and `scope:shared`. It must not import a personal specialization, a server app, or gateway transport.

## Data & persistence

Owns the `MemoryFactCatalog` and `MemoryOutboxEvent` use-case boundary for the `memory.prisma`
models. The app-owned clean target baseline remains the one database setup boundary; its SQL
authority test lives at `src/__tests__/memory-authority.sql` and runs through this package's
`test:sql` target.

## See also

- Parent group: [agent memory](../README.md)
- Related selection: [personal memory](../../personal/memory/main/README.md)
- Content boundary: [memory gateway](../../../../server/_infra/memory-gateway-client/README.md)
