# @opencrane/backend/server/infra/workflows/contract — durable task port

> [infra](../../README.md) › [workflows](../README.md) › contract

## What it owns

This Phase-0 package defines the engine-neutral contract for resumable control-plane tasks. A future
product transaction will admit a task here; an engine adapter will run it and provide checkpoints,
events, child tasks, and cancellation. Future server composition will hold the separate worker-runtime
port. The currently shipped adapter is Absurd, a PostgreSQL-backed engine; domains still use this
contract rather than Absurd directly.

```text
 product write + durable task
       │  caller-owned Prisma transaction + stable idempotency key
       ▼
 ┌─────────────────────────────┐
 │ workflows contract ◄── HERE │  domain code sees no engine
 └──────────────┬──────────────┘
                │  opaque transaction
                ▼
   Absurd adapter ──► absurd.spawn_task ──► Absurd tables in silo PostgreSQL
          └──────────── product write + task share one commit decision
                                                           │ committed task
                                                           ▼
       server worker ──► queue ──► registered handler
                                    └── checkpoint / event / child / sleep; state, retry + cancellation persist
```

**In this flow:** the [Absurd adapter](../infra_absurd/README.md), the [workflow index](../README.md),
and the server worker lifecycle (not yet composed by an OpenCrane application).

It guarantees that every task admission carries the caller's opaque transaction context. It does
not own a database client, an engine schema, recurring schedules, product cron rules, or a worker
deployment.

## Public surface

- `DurableExecution` — domain port for registering, admitting, signalling, and cancelling tasks.
- `DurableTaskQueueAuthority` — one immutable reviewed queue map shared by the kit and adapter.
- `DurableWorkerRuntime` — server-composition port for starting and draining workers.
- `DurableTaskContext` — checkpoint, event, child-task, and sleep operations for a running task.
- Task, event, receipt, worker lifecycle, and closed retryable/terminal/compensation error types.

## Boundary

Server composition and engine adapters consume this package. Domain packages should depend on the
port rather than an engine SDK; adapters validate the opaque transaction client internally.

## Dependency direction

This is a `layer:infra`, `scope:workflows` library. It has no package dependencies and must never
import backend domains, applications, database clients, or an execution engine.

## See also

- Parent: [workflows](../README.md)
