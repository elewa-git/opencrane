# @opencrane/backend/agents/execution/runs/workflows/contract — AgentRun task vocabulary

> [agent-run authority](../../main/README.md) › [workflows](../README.md) › contract

## What it owns

This package belongs to the AgentRun execution flow. An **AgentRun** is one execution of an agent;
an **attempt** is one try at completing that execution. This package gives the OpenCrane server and
the agent controller one agreed name and shape for the future saved task that represents an attempt.

The contract carries only the silo ID, run ID, attempt number, retry rule, and terminal-state
vocabulary. The future server admission and controller handler can use those values without putting
other runtime details in the task record.

```text
 future AgentRun attempt workflow
       │ task name, IDs, retry rule, result
       ▼
 ┌──────────────────────────────────────────────┐
 │ AgentRun workflow task contract  ◄── HERE     │
 └──────────────────────────────────────────────┘
       │ task name, input, retry rule, result
       ▼
 future controller registers and runs the handler
```

**In this flow:** [AgentRun workflows](../README.md) provides the shared location for this task;
[workflow rules](../../../../../../server/infra/workflows/contract/README.md) define how a saved task
uses the same database transaction as the product change.

The contract guarantees that its input and result expose only stable identifiers and a terminal
state. If a later caller adds prompt text, credentials, model output, or Kubernetes object details,
it would expose data in the durable task record; that data must stay behind the server authority.

## Public surface

- `AgentRunTaskNames` — gives the saved AgentRun attempt task its stable name.
- `AgentRunTaskDeclaration` — defines its queue and retry policy.
- `AgentRunTaskInput` — carries the silo ID, run ID, and attempt number.
- `AgentRunTaskResult` — reports the same attempt and its terminal state.
- `AgentRunTaskTerminalStates` — lists the completed, failed, and cancelled outcomes.

## Boundary

The server and controller may share these types, but this package does not save tasks, read the
database, create Kubernetes objects, or run an agent. It is vocabulary, not a second execution path;
the required persistence, handler, and migration work belong outside this package.

## Dependency direction

This is a contract library (`layer:contract`, `scope:execution-runs-workflow-contract`). It may
import shared workflow contract types, but must not import application composition, database clients,
Kubernetes clients, or the AgentRun runtime implementation.

## See also

- Parent: [AgentRun workflows](../README.md)
- [Agent run authority](../../main/README.md)
- [Workflow rules](../../../../../../server/infra/workflows/contract/README.md)
