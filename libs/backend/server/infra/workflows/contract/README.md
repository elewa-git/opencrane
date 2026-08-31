# @opencrane/backend/server/infra/workflows/contract — workflow rules

> [infra](../../README.md) › [workflows](../README.md) › contract

## What it owns

This package defines the shared rules for a **workflow**: work that may take time, wait for something,
and continue later. For example, a workflow can wait for a person's reply, wait until a date, or start
another task. Application code uses these rules instead of talking to Absurd directly. Absurd is
the tool that stores and runs the workflow in the PostgreSQL database.

When an application saves a change and starts a workflow, it must pass the **same database transaction**
to both operations. Then the database saves both changes together, or saves neither one if something
goes wrong.

```text
 a change needs work that can happen later
       │  use the exact same database transaction for both steps
       ▼
 ┌─────────────────────────────┐
 │ workflows contract ◄── HERE │  shared rules for starting and running work
 └──────────────┬──────────────┘
                │  start the task
                ▼
        Absurd saves the task in the PostgreSQL database
                │  the change and task are saved together, or neither is saved
                ▼
      a local or remote worker finds the saved task and runs its handler
                └── save progress · wait for input or time · start another task · stop a task
```

**In this flow:** the [Absurd adapter](../infra_absurd/README.md), the [workflow index](../README.md),
and a worker: the part of the server that finds saved tasks and runs them. The OpenCrane server
starts this worker for registered control-plane tasks and lets active work finish during shutdown.

The important rule is that starting a workflow travels with the database change that asked for it.
This package does not own a database connection, the Absurd database tables, recurring schedules, or
the server process that runs workers.

### Planned 0.10.0 cutover

The next release changes how this workflow path is deployed and how MCP bundles are admitted. This
is a direct forward migration from tagged 0.9.2 to 0.10.0. The abandoned 0.9.3 candidate was never
tagged and is not a supported release boundary.

```text
  tagged 0.9.2 release state
          │  forward migration
          ▼
  Prisma Migrate ──► dedicated migration Job ──► 0.10.0 schema
  only record of database changes      │
                                      ▼
  OCI Image Layout ZIP admission ──► imported immutable image digest
  MCP 2026-07-28 only                 │
                                      ▼
  MCP RuntimeWorkloadClaim ──► MCP executor and class-specific pool profile

  remote v2 MCP server ──► keep its era-probe workflow

  retire MCPB routes, schema, and workers
```

**In this cutover:** [Prisma Migrate](../../../../../../docs/agents/versioning.md) is the only
record of database changes, and the dedicated migration Job is the one-time Kubernetes task that
runs those changes before the new release starts. An OCI (Open Container Initiative) Image Layout
ZIP replaces MCPB, the old MCP bundle format. The new admission accepts only Model Context Protocol
(MCP) version `2026-07-28` and keeps the remote v2 [era-probe workflow](../../mcp-era-probe/README.md)
that checks a remote MCP server before it is accepted. OCI admission and import are separate from
runtime execution: import produces an immutable image digest, then the MCP-specific executor uses a
`RuntimeWorkloadClaim` with its own pool profile. The existing generic agent warm Pod has a fixed
image and must not run an uploaded OCI image. The cutover removes the MCPB routes, database schema,
and workers instead of keeping an old path beside the replacement.

## Public surface

- `IWorkflowEngine` — declares or registers a task, starts it, sends it information, or stops it;
  product repositories can send an event through their existing database transaction.
- `IWorkflowTaskDeclaration` — permits transaction-bound admission when another process owns the handler.
- `IWorkflowTaskQueueAuthority` — chooses the approved queue, a named list of work for a worker, for each task.
- `IWorkflowWorkerRuntime` — starts workers and lets them finish their current work before stopping.
- `IWorkflowTaskContext` — lets a running task save progress, wait at a named replay point, or start
  and wait for another task.
- `IWorkflowTaskRetryPolicy` — sets the total attempt limit and the delay before each later attempt.
- Task, event, receipt, worker-lifecycle, and error types — describe the information passed between these steps.

## Boundary

Application code uses `IWorkflowEngine`; only the Absurd adapter talks to the Absurd software.
The adapter receives the database transaction and keeps that database-specific detail out of the
application's workflow code.

## Dependency direction

This is a shared contract library (`layer:contract`, `scope:workflows`). It has no package dependencies.
It must not import application code, database clients, or Absurd: those details belong to the parts
of the system that use or implement these workflow rules.

## See also

- Parent: [workflows](../README.md)
