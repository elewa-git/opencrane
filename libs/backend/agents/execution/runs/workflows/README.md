# AgentRun workflows

> [agent-run authority](../main/README.md) › workflows

This group owns the vocabulary and admission rule that the OpenCrane server uses to save one
workflow task for each AgentRun attempt. A **workflow** is work that can pause and continue later,
even after a process restart.

| Child | Purpose |
| --- | --- |
| [contract](contract/README.md) | Names the saved task and the small, safe input and result shared by the server and controller. |
| [main](main/README.md) | Admits or reuses the task and binds its receipt through one caller-owned database transaction. |

```text
 AgentRun admission or retry
                 │ task name + silo, run, and attempt IDs
                 ▼
 ┌───────────────────────────────────────────┐
 │ AgentRun workflow contract   ◄── HERE      │
 └───────────────────────────────────────────┘
                 │ saved task + receipt
                 ▼
  later controller handler runs the attempt
```

The declaration carries only the task name, silo ID, run ID, attempt number, retry rule, and result
shape. Neither side may put prompt text, credentials, model output, or Kubernetes object details in
that task input.

First admission and retry now save and receipt-bind the task in their existing database transaction.
This group still does not register the controller handler, create Kubernetes work, or replace the
current dispatcher. Those runtime changes belong to the next replacement slice.

## Dependency direction

This grouping directory contains contract libraries shared by the agent-run authority and its
controller. Its children may depend on shared workflow contracts, but must not import application
composition, database clients, or Kubernetes clients.

## See also

- Parent: [Agent run authority](../main/README.md)
- [Workflow rules](../../../../../server/infra/workflows/contract/README.md)
