# @opencrane/backend/agents/execution/runs — agent-run authority

> [backend](../../../../README.md) › [agents](../../../README.md) › [execution](../../README.md) › runs

## What it owns

A **run** is one request for an agent to do work. An **attempt** is one try at finishing that run.
A **workflow** is a saved task that can continue after a server or controller restart.

This package saves the run, its fixed input, and its workflow task in one database transaction. It
also owns retries, warm-runtime claims, runtime events, cancellation, and final run state.

```text
 request
   │
   ▼
 ┌────────────────────────────────────────────────────────────┐
 │ runs package  ◄── HERE                                     │
 │ save run + fixed input + task in one database transaction │
 └────────────────────────────────────────────────────────────┘
   │
   ▼
 Absurd runs the saved task
   │
   ▼
 reserve one warm Pod → activate it → bind it to the run
   │
   ▼
 agent works → server saves events → workflow deletes the used Pod
```

**In this flow:** [input assembler](../../inputs/main/README.md) · [workflow handler](../controller/README.md) · [runtime controller](../../../runtime/controller/README.md)

The server is always the source of truth. Kubernetes shows where work runs, but a Pod label or name
does not grant permission to use a run.

## Main rules

- A duplicate admission returns the first saved input only when the caller and request match.
- A retry keeps the same logical run and fixed input, but starts the next attempt.
- A warm Pod can be claimed once. It is never returned to the generic pool after use.
- The Pod receives its model key only after the database has saved the exact Pod identity and proof
  key.
- Runtime events are accepted only for the current run, attempt, Pod, and command.
- Cancellation changes the database state first. Physical cleanup follows that saved decision.
- Competing writes use serializable database transactions and typed compare-and-set updates.

## Public surface

- `PrismaRunAdmissionRepository` saves a new run, its fixed input, and its workflow task together.
- `PrismaAgentRunRetryUnitOfWork` starts the next attempt after checking the current terminal state.
- `PrismaAgentRunWarmRuntimeUnitOfWork` reserves a warm Pod and records activation, readiness,
  deletion, and workflow completion.
- `PrismaWarmRuntimeBindingUnitOfWork` binds the reviewed warm Pod to its saved reservation and returns
  the short-lived model key in memory.
- `__CreateWarmRuntimeBindingRouter` exposes the private warm-Pod binding route.
- `__CreateAgentRunWorkflowControllerRouter` exposes the private controller operations used by the
  saved workflow.
- `PrismaRuntimeEventReporter` and `PrismaRuntimeTerminalReporter` save accepted runtime progress and
  terminal results.
- `PrismaRunCancellationRepository` saves cancellation and cleanup decisions.
- The self-run routers expose status, retry, and cancellation to the signed-in participant.

## Boundary

This package does not choose personas, memory, tools, models, or Kubernetes settings. The input
assembler supplies the fixed run input. The controller package performs Kubernetes calls. The
agent-runtime process runs the model loop.

The package does not run uploaded OCI images. OCI-backed MCP and code-skill workloads use their own
executor class and meet AgentRun through the shared workload-claim contract.

## Dependency direction

Tagged `scope:execution-runs`: it may depend on agent-domain, authorization, workflow-contract, and
shared backend libraries. It never imports an application or Kubernetes client.

## Data and persistence

The main records are `AgentRun`, `RunInputSnapshot`, `AgentRunWorkflowTask`,
`WarmRuntimeReservation`, `WorkloadAssignment`, `WorkloadBootstrap`, `RunProofKey`, and ordered run
events. Admission saves the run, fixed input, and workflow task together. Warm-runtime changes are
saved before the next Kubernetes step begins.

## See also

- [AgentRun workflow handler](../controller/README.md)
- [Workflow contract](../workflows/contract/README.md)
- [Warm Kubernetes controller](../../../runtime/controller/README.md)
- [Warm pool definitions](../../../runtime/k8s-launcher/README.md)
- [Execution input assembler](../../inputs/main/README.md)
