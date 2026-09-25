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
function. Product repositories may also emit a task event through that transaction with the fixed
`absurd.emit_event` procedure. Absurd keeps the first payload for one task-scoped event name, so a
replayed product write cannot replace the event that already woke the task.
Server composition supplies the shared Prisma rollback checker through `isRolledBackConflict`.
Both transactional procedure adapters preserve errors recognised by that checker unchanged, so
the product's shared transaction runner can retry the complete operation. This includes Prisma
P2010 with PostgreSQL SQLSTATE `40001`; other database and input-serialization failures remain
wrapped. The adapters do not retry a procedure alone or change nontransactional worker behaviour.
Worker-only processes omit the checker and do not load Prisma. Both transaction-bound methods
refuse before SQL if their process did not supply it.
Each declared or registered job also supplies its total attempt limit and retry delay. The adapter
stores those limits with the Absurd task, including when the task is started inside a product database transaction.
A retryable error lets Absurd schedule the next attempt. A terminal error is saved as failed before
the SDK can apply that general retry policy, so work that cannot succeed unchanged stops immediately.
Before an uncached checkpoint operation starts, the adapter extends the claimed task lease by the
configured `checkpointOperationLeaseSeconds` bound (120 seconds by default). Absurd replays cached
steps without invoking either the heartbeat or the operation, so a replay cannot repeat the effect.
The opt-in `checkpoint-lease.integration.test.ts` qualification uses a one-second SQL claim to
reclaim a run: the stale run's heartbeat rejects before its sentinel effect, and the replacement
run commits the checkpoint. The uncached `test:sql` target sets
`OPENCRANE_ABSURD_SQL_QUALIFICATION=1`; provide `DATABASE_URL` and run
`npm exec -- nx run backend-server-infra-workflows-infra-absurd:test:sql --excludeTaskDependencies`
against a database with the pinned Absurd SQL installed.

## Dependency direction

This is a `type:lib`, `layer:infra`, `scope:workflows` package. It depends on the workflows contract,
and external engine/database types; its worker entrypoint has no runtime Prisma dependency. The
server and separate SQL qualification entrypoint bind the Prisma-aware rollback checker. It never
imports a domain package or application.

## Data & persistence

`vendor/absurd.sql` is the Apache-2.0 Absurd 0.5.0 schema snapshot, attributed under the verbatim
[upstream license](./vendor/LICENSE). Database setup remains outside this adapter. Setup must create
every approved queue before the application can save jobs. The adapter does not create queues on a
separate database connection because the product change and its job must be saved together.

## See also

- Parent index: [workflows](../README.md)
- Contract package: [contract](../contract/README.md)
