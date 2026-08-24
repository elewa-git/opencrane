# @opencrane/backend/server/infra/workflows/contract — workflow rules

> [infra](../../README.md) › [workflows](../README.md) › contract

## What it owns

This package defines the shared rules for a **workflow**: work that may take time, wait for something,
and continue later. For example, a workflow can wait for a person's reply, wait until a date, or start
another task. Application code will use these rules instead of talking to Absurd directly. Absurd is
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
      a worker finds the saved task and runs its handler
                └── save progress · wait for input or time · start another task · stop a task
```

**In this flow:** the [Absurd adapter](../infra_absurd/README.md), the [workflow index](../README.md),
and a worker: the part of the server that finds saved tasks and runs them. An OpenCrane application
does not start that worker yet.

The important rule is that starting a workflow travels with the database change that asked for it.
This package does not own a database connection, the Absurd database tables, recurring schedules, or
the server process that runs workers.

## Public surface

- `IWorkflowEngine` — starts a task, sends it information, or stops it.
- `IWorkflowTaskQueueAuthority` — chooses the approved queue, a named list of work for a worker, for each task.
- `IWorkflowWorkerRuntime` — starts workers and lets them finish their current work before stopping.
- `IWorkflowTaskContext` — lets a running task save progress, wait, or start and wait for another task.
- Task, event, receipt, worker-lifecycle, and error types — describe the information passed between these steps.

## Boundary

Application code will use `IWorkflowEngine`; only the Absurd adapter talks to the Absurd software.
The adapter receives the database transaction and keeps that database-specific detail out of the
application's workflow code.

## Dependency direction

This is an infrastructure library (`layer:infra`, `scope:workflows`). It has no package dependencies.
It must not import application code, database clients, or Absurd: those details belong to the parts
of the system that use or implement these workflow rules.

## See also

- Parent: [workflows](../README.md)
