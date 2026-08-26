# @opencrane/backend/server/infra/workflows/infra_absurd — Absurd workflow engine adapter

> [backend](../../../../README.md) › [server](../../../README.md) › [infra](../../README.md) › [workflows](../README.md) › infra_absurd

## What it owns

This package connects the shared workflow rules to Absurd. Absurd stores background jobs in
PostgreSQL and runs them after a server restart. This package owns the Absurd-specific calls and a
reviewed SQL snapshot, but it does not decide what product jobs do.

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

`_CreateAbsurdWorkflowEngine` creates the engine and worker ports used by server composition. Its
return type exposes `IWorkflowEngine` and `IWorkflowWorkerRuntime`, not an Absurd SDK object.
The engine can also declare a task whose handler runs in another process. That declaration permits
the server to save the task in a product transaction without starting a local worker for it.

## Boundary

Only this package imports `absurd-sdk`. It owns no product data, recurrence, queue naming, or tracing
policy; those stay above the engine adapter. The server gives it the same approved queue list as the
workflow guard, so it cannot choose another queue. Workers use the SDK. Starting a saved job uses the
database transaction supplied by the product change and the parameterised `absurd.spawn_task`
function.
Each declared or registered job also supplies its total attempt limit and retry delay. The adapter
stores those limits with the Absurd task, including when the task is started inside a product database transaction.
A retryable error lets Absurd schedule the next attempt. A terminal error is saved as failed before
the SDK can apply that general retry policy, so work that cannot succeed unchanged stops immediately.

## Dependency direction

This is a `type:lib`, `layer:infra`, `scope:workflows` package. It may depend only on the workflows contract and external engine/database types; it never imports a domain package or application.

## Data & persistence

`vendor/absurd.sql` is the Apache-2.0 Absurd 0.5.0 schema snapshot, attributed under the verbatim
[upstream license](./vendor/LICENSE). Database setup remains outside this adapter. Setup must create
every approved queue before the application can save jobs. The adapter does not create queues on a
separate database connection because the product change and its job must be saved together.

## See also

- Parent index: [workflows](../README.md)
- Contract package: [contract](../contract/README.md)
