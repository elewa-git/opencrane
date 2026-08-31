# AgentRun workflows

> [agent-run authority](../main/README.md) › workflows

This group maps the vocabulary that the OpenCrane server and the agent controller will share when a
saved workflow runs one AgentRun attempt. A **workflow** is work that can pause and continue later,
even after a process restart.

| Child | Purpose |
| --- | --- |
| [contract](contract/README.md) | Names the saved task and the small, safe input and result shared by the server and controller. |
| [main](main/README.md) | Admits or reuses the task and binds its receipt through one caller-owned database transaction. |

```text
 future AgentRun attempt workflow
                 │ task name + silo, run, and attempt IDs
                 ▼
 ┌───────────────────────────────────────────┐
 │ AgentRun workflow contract   ◄── HERE      │
 └───────────────────────────────────────────┘
                 │ registered handler
                 ▼
  future admission rule saves the task, then a controller handler runs the attempt
```

The declaration carries only the task name, silo ID, run ID, attempt number, retry rule, and result
shape. Neither side may put prompt text, credentials, model output, or Kubernetes object details in
that task input.

This group does not yet save a task, register a handler, create Kubernetes work, or replace the
current dispatcher. Those runtime and migration changes belong to a later replacement slice.

## Dependency direction

This grouping directory contains contract libraries shared by the agent-run authority and its
controller. Its children may depend on shared workflow contracts, but must not import application
composition, database clients, or Kubernetes clients.

## See also

- Parent: [Agent run authority](../main/README.md)
- [Workflow rules](../../../../../server/infra/workflows/contract/README.md)
