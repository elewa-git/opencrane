# backend-server-infra-workflows-infra-absurd — Absurd workflow engine adapter

> [backend](../../../../README.md) › [server](../../../README.md) › [infra](../../README.md) › [workflows](../README.md) › infra_absurd

## What it owns

This package adapts the workflow-engine port to the Absurd workflow engine. Absurd is a
PostgreSQL-backed task engine; the live qualification session composes it here, while product code
uses the engine-neutral contract. This package owns engine-specific vocabulary and a reviewed SQL
snapshot, but no product workflow rules.

```text
 domain task ──► workflows contract ──► ┌─────────────────┐
                                        │ infra_absurd     │ ◄── HERE
                                        └────────┬────────┘
                                                 │ task / step / event
                                                 ▼
                                            Absurd schema
```

**In this flow:** the [workflows contract](../contract/README.md) and the [workflow index](../README.md).

The vendored SQL is pinned byte-for-byte to Absurd 0.5.0. A mismatch between its recorded SHA-256 digest and the source must stop bootstrap review: applying an unreviewed engine schema would give a vendor change authority over every silo.

## Public surface

This package has no package-level public API. It deliberately omits a `src/index.ts` barrel: the
live qualification session constructs `AbsurdWorkflowEngine` inside this package, while product code
depends on the engine-neutral `IWorkflowEngine` contract.

## Boundary

Only this package imports `absurd-sdk`. It owns no product data, recurrence, queue naming, or tracing policy; those stay above the engine adapter. Server composition gives it the same immutable queue authority as the workflow guard, so it cannot fall back to a different queue. Worker operations use the SDK, while transactional spawns use only the caller-owned Prisma transaction and the parameterised `absurd.spawn_task` function.

## Dependency direction

This is a `type:lib`, `layer:infra`, `scope:workflows` package. It may depend only on the workflows contract and external engine/database types; it never imports a domain package or application.

## Data & persistence

`vendor/absurd.sql` is the Apache-2.0 Absurd 0.5.0 schema snapshot, attributed under the verbatim [upstream license](./vendor/LICENSE). Bootstrap ownership and live schema application remain outside this adapter. The bootstrap pipeline must call `absurd.create_queue` for every configured queue before application transactions can admit tasks; this adapter deliberately does not create queues on a separate connection because that would break the same-transaction spawn boundary.

## See also

- Parent index: [workflows](../README.md)
- Contract package: [contract](../contract/README.md)
