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
- Status, cancellation, and retry use the current exact `AgentRun` grant. Ownership, conversation
  participation, lifecycle state, attempt fencing, and workload proof remain separate safety facts;
  none of them grants product permission by itself.
- A warm Pod can be claimed once. It is never returned to the generic pool after use.
- The assignment stays stable across runtime replacement. Its binding generation selects the current
  Pod reservation, bootstrap, and proof key; earlier generations remain revoked history.
- Before a Pod receives a model key, the binding transaction rechecks the run principal's current
  exact `ModelDefinition/Use` grant and, when present, its exact `ProviderConnection/Use` grant.
- The database saves one `RunModelCredentialMintAuthorization` before commit. A second serializable
  transaction spends that row once before LiteLLM is called, so a replay cannot mint another key.
- Runtime events are accepted only for the current run, attempt, Pod, and command. Their sequence is
  global to the durable run, while terminality is scoped to the attempt that emitted the event.
- A terminal child result is delivered once per child attempt. A suppression belongs to the current
  parent attempt, so retrying the parent can reconsider a result that its earlier stream could not accept.
- Cancellation changes the database state first. The saved workflow then removes the exact used Pod
  and completes any provider output handoff.
- Cancellation becomes final only after that workflow cleanup has finished. Pending approvals and
  participant requests close without resuming the run.
- Competing writes use serializable database transactions and typed compare-and-set updates.

## Public surface

- `PrismaRunAdmissionUnitOfWork` saves a new run, its fixed input, and its workflow task together.
- `PrismaAgentRunRetryUnitOfWork` starts the next attempt after checking the current terminal state,
  current participant identity, and exact `AgentRun/Retry` grant in the write transaction.
- `PrismaAgentRunWarmRuntimeUnitOfWork` reserves a warm Pod, records activation and readiness, and
  replaces a dead waiting runtime only after the saved continuation has been checked and fenced.
- `AgentRunRuntimeContinuationRecoveryPort` lets the run lifecycle ask the protocol authority to
  validate the saved continuation and fence the dead runtime before advancing the binding generation.
- `PrismaWarmRuntimeBindingUnitOfWork` binds the reviewed warm Pod to its saved reservation and returns
  the short-lived model key in memory.
- `PrismaRunModelCredentialMintAuthorizationRepository` spends the exact saved mint authorization
  before the post-commit LiteLLM call.
- `__CreateWarmRuntimeBindingRouter` exposes the private warm-Pod binding route.
- `__CreateAgentRunWorkflowControllerRouter` exposes the private controller operations used by the
  saved workflow.
- `PrismaRuntimeEventReporter` and `PrismaRuntimeTerminalReporter` save accepted runtime progress and
  terminal results.
- `PrismaRunCancellationUnitOfWork` owns the database transaction for the exact `AgentRun/Cancel`
  admission, attempt fence, revocations, and workflow cancellation event.
- The self-run routers expose status, retry, and cancellation to the signed-in participant. Status
  first finds owner-eligible runs, then filters those candidates through current exact
  `AgentRun/Read` grants in the same database snapshot.

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
`WarmRuntimeReservation`, `WorkloadAssignment`, `WorkloadBootstrap`, `RunProofKey`,
`RunModelCredentialMintAuthorization`, `ChildRunCompletionDelivery`, and ordered run events. Admission
saves the run, fixed input, and workflow task together. Each
`WarmRuntimeReservation`, `WorkloadBootstrap`, and `RunProofKey` belongs to one binding generation.
Warm-runtime changes are saved before the next Kubernetes step begins.

## See also

- [AgentRun workflow handler](../controller/README.md)
- [Workflow contract](../workflows/contract/README.md)
- [Warm Kubernetes controller](../../../runtime/controller/README.md)
- [Warm pool definitions](../../../runtime/k8s-launcher/README.md)
- [Execution input assembler](../../inputs/main/README.md)
