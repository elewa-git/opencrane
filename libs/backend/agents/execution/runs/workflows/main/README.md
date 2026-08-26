# @opencrane/backend/agents/execution/runs/workflows — AgentRun task admission

> [agent-run authority](../../main/README.md) › [workflows](../README.md) › main

## What it owns

This package owns the small admission rule for an AgentRun workflow task. An **AgentRun** is
one execution of an agent; an **attempt** is one try at completing it. A **workflow** is work that
can pause and continue later, even after a process restart.

The caller gives this rule one database transaction. The rule asks its repository to create or find
the task record, saves the matching remote task through that same transaction, and binds the receipt
before the transaction can commit.

```text
 run admission or retry
             │ caller-owned database transaction
             ▼
 ┌───────────────────────────────────────────┐
 │ AgentRun task admission  ◄── HERE          │
 └───────────────────────────────────────────┘
             │ task record + matching receipt
             ▼
 saved controller-hosted workflow task
```

**In this flow:** [task contract](../contract/README.md) provides the task name and safe input;
[workflow rules](../../../../../../server/infra/workflows/contract/README.md) provide the remote-task
engine interface.

This package rejects a missing record, changed silo/run/attempt facts, an empty task key, a changed
receipt, or a conflicting binding. The AgentRun database adapter now supplies the record and uses
this rule for both first admission and retry. A later controller slice will use the saved task.

## Public surface

- `__AdmitAgentRunWorkflowTask` creates or finds task facts, saves the task, and binds its receipt.
- `AgentRunWorkflowAdmissionTransaction` and `AgentRunWorkflowTaskRepository` describe the two
  transaction-scoped ports supplied by the AgentRun database adapter.
- `AgentRunWorkflowAdmissionRejectionReasons` and `AgentRunWorkflowAdmissionError` describe why
  admission must stop before the task is saved.

## Boundary

This package does not open a database transaction, use Prisma, create Kubernetes work, start a
controller handler, or replace the current dispatcher. It is the reusable rule used by the atomic
database write for both first admission and retry.

## Dependency direction

This backend library is tagged `scope:execution-runs`. It may import AgentRun workflow contracts and
the shared workflow contract, but must not import apps, Prisma adapters, Kubernetes clients, or a
workflow-engine vendor adapter.

## See also

- Parent: [AgentRun workflows](../README.md)
- Sibling: [task contract](../contract/README.md)
- [Agent run authority](../../main/README.md)
