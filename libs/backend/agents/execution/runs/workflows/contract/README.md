# @opencrane/backend/agents/execution/runs/workflows/contract — AgentRun task and controller vocabulary

> [agent-run authority](../../main/README.md) › [workflows](../README.md) › contract

## What it owns

This package belongs to the AgentRun execution flow. An **AgentRun** is one execution of an agent;
an **attempt** is one try at completing that execution. This package gives the OpenCrane server and
the agent controller one agreed shape for the saved task and for the server authority the controller
uses while it runs that attempt.

The saved task carries only the silo ID, run ID, attempt number, retry rule, and terminal-state
vocabulary. The shared controller types carry non-secret runtime facts and binding commands after the
task starts; they are not part of the durable task input.

```text
 AgentRun attempt workflow
       │ task name, IDs, retry rule, result
       ▼
 ┌──────────────────────────────────────────────┐
 │ AgentRun workflow task contract  ◄── HERE     │
 └──────────────────────────────────────────────┘
       │ task name, input, retry rule, result
       ▼
 controller claims and runs one warm Pod
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
- `AgentRunWorkflowControllerRecord` — carries the server-approved facts for one warm-runtime claim.
- `AgentRunWarmRuntimeReservationCommand` — describes one generic warm Pod offered for reservation.
- `AgentRunWarmRuntimeActivationCommand` and `AgentRunWarmRuntimeReadinessCommand` — record the exact
  profile change and readiness proof.
- `AgentRunWarmRuntimeDeletionCommand` — names the exact used Pod that must be deleted.
- `AgentRunWarmRuntimeReplacementOutcome` — says whether a dead waiting runtime may continue on a
  new binding generation or must stop for recovery.
- `AgentRunWarmRuntimeUnreservedCancellationOutcome` and
  `__ParseAgentRunWorkflowUnreservedCancellationOutcome` — tell the handler whether cancellation
  finished without a Pod, must wait, or must continue through the saved Pod deletion path.
- `AgentRunWorkflowObservation` — distinguishes active model work, waiting for input, recovery, and
  terminal states so the controller never replays an unsafe model call.
- `AgentRunWarmRuntimeControllerAuthority` — defines the server operations that save these steps.

## Boundary

The server and controller may share these types, but this package does not save tasks, read the
database, create Kubernetes objects, or run an agent. Controller-specific Kubernetes and deployment
options remain in the controller package. This is vocabulary, not a second execution path; the
database adapter and controller handler belong outside this package.

## Dependency direction

This is a contract library (`layer:contract`, `scope:execution-runs-workflow-contract`). It may
import shared workflow contract types, but must not import application composition, database clients,
Kubernetes clients, or the AgentRun runtime implementation.

## See also

- Parent: [AgentRun workflows](../README.md)
- [Agent run authority](../../main/README.md)
- [Workflow rules](../../../../../../server/infra/workflows/contract/README.md)
