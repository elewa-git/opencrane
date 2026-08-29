# @opencrane/backend/agents/skills/workflows — skill workflow admission

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › [workflows](../README.md) › main

## What it owns

This package defines the transaction-bound admission rule for checking a draft Python skill. A
workflow is a saved task that can continue after a process restart. The OpenCrane server saves that
task inside the same database transaction as the validation record. A separate controller process
runs the handler and can safely continue the task after either process restarts.

```
 product change + validation record
              │ same database transaction
              ▼
 ┌───────────────────────────────────┐
 │ skill workflows  ◄── HERE          │ save / find validation + task receipt
 └───────────────────────────────────┘
              │ validation id only
              ▼
 server declaration ──► controller handler ──► isolated authoring Job
```

**In this flow:** [workflow contract](../../../../server/infra/workflows/contract/README.md)
defines the engine-neutral task port · [controller](../../controller/README.md) runs the
Kubernetes Job handler · [k8s-launcher](../../k8s-launcher/README.md) builds the restricted Job.

The package accepts only immutable IDs and content addresses. It never carries artifact bytes,
credentials, HTTP requests, Kubernetes clients, or a Prisma client. If the repository cannot still
prove the same silo owns a Draft Python revision and its pinned active artifact, the admission fails
before any task is saved.

## What happens after admission

| Saved state | New event | What the workflow does |
|---|---|---|
| Pending, no Job saved | Controller claims the task | Creates a suspended Job, then saves its Kubernetes UID before releasing it. |
| Pending, no Job saved | Claim expires before the retry limit | Deletes the exact suspended Job it created, if any, and asks the server for the next delivery. |
| Pending, no Job saved | Final claim expires | Changes the validation to Failed with `claim_expired_before_workload`; no further delivery is issued. |
| Pending or Running | The Job-binding reply is lost | Replays the bind against the database; if it was already saved, adopts that exact Job UID instead of renewing or creating another Job. |
| Pending or Running | The controller and database clocks disagree | Uses database time before binding, releasing, or saving expiry. It continues when the database says the claim is active; an early recovery check waits one second and tries again. |
| Running, Job saved | First Pod appears | Saves that exact Pod UID, then lets the one-use bootstrap serve only that Pod. |
| Running, Job saved | Claim expires before a Pod is saved | Changes the validation to Failed and deletes only the Job with the saved UID. |
| Running, Pod saved | No worker result yet | Checks the saved result and exact Job state every second. |
| Running, Pod saved | Worker result is saved | Applies the result, copies passing reports to the same Draft revision, and deletes the exact Job. |
| Running, Pod saved | Job disappears or finishes without a result | Changes the validation to Failed and deletes only the Job with the saved UID. |
| Pending or Running | Validation is cancelled | Stops without creating more work; cleanup still names the exact saved Job UID. |
| Any state | Task is replayed after restart | Reuses completed named steps and continues from the first unfinished step. |
| Any state | A database compare-and-set loses to completion or cancellation | Reloads the saved result and does not overwrite the winning terminal state. |

## Public surface

- `__AdmitSkillAuthoringValidation` creates or finds an immutable validation, saves the remote task
  in the caller's database transaction, and binds the task receipt.
- The [task contract](../contract/README.md) gives the server and controller the same task name and
  retry policy.
- `SkillAuthoringValidationAdmissionTransaction` and `SkillAuthoringValidationRepository` are the
  narrow ports an application adapter supplies from one caller-owned database transaction.

## Boundary

The OpenCrane server composition declares and admits this task but does not run it. The
agent-controller composition registers the handler and is the only process that may create the
Kubernetes Job. The previous authoring poller and its generic workload routes are gone. The server
mounts workflow-specific bootstrap, input, and completion routes for the exact saved validation;
the separate tool runner keeps its existing bootstrap route. This package does not parse OCI (Open
Container Initiative) ZIP files or admit MCP (Model Context Protocol) bundles; the OCI import path
hands runtime work an already immutable image digest through its shared seam.

## Dependency direction

Tagged `scope:skills`, this package may depend on the engine-neutral `scope:workflows` contract,
the skill workflow task contract, and the other approved skill dependencies. It never imports an
app, Prisma adapter, HTTP router, Kubernetes adapter, controller implementation, or workflow-engine
vendor adapter.

## See also

- Parent: [workflows](../README.md)
- Siblings: [task contract](../contract/README.md) · [controller](../../../controller/README.md)
