# @opencrane/backend/agents/skills/workflows — skill workflow admission

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [skills](../../../README.md) › [workflows](../README.md) › main

## What it owns

This package defines the transaction-bound admission rule for checking a draft Python skill. A
workflow is a saved task that can continue after a process restart. When a later product adapter
uses this rule, the server will save that task inside the same database transaction as the product
change, while a separate controller process will run its handler.

This is an approved ports-only initial slice. The product schema, repository adapter, route, and
deployable controller registration are not wired yet, so no validation currently reaches this flow.

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

**In the planned flow:** [workflow contract](../../../../server/infra/workflows/contract/README.md)
defines the engine-neutral task port · [controller](../../controller/README.md) later runs the
Kubernetes Job handler · [k8s-launcher](../../k8s-launcher/README.md) builds the restricted Job.

The package accepts only immutable IDs and content addresses. It never carries artifact bytes,
credentials, HTTP requests, Kubernetes clients, or a Prisma client. If the repository cannot still
prove the same silo owns a Draft Python revision and its pinned active artifact, the admission fails
before any task is saved.

## Public surface

- `__AdmitSkillAuthoringValidation` creates or finds an immutable validation, saves the remote task
  in the caller's database transaction, and binds the task receipt.
- The [task contract](../contract/README.md) gives the server and controller the same task name and
  retry policy.
- `SkillAuthoringValidationAdmissionTransaction` and `SkillAuthoringValidationRepository` are the
  narrow ports an application adapter supplies from one caller-owned database transaction.

## Boundary

The OpenCrane server composition declares this task but does not run it. A later agent-controller
composition will register the handler and be the process that may create the Kubernetes Job. This
package does not parse OCI (Open Container Initiative) ZIP files or admit MCP (Model Context
Protocol) bundles; the OCI import path hands runtime work an already immutable image digest through
its shared seam.

## Dependency direction

Tagged `scope:skills`, this package may depend on the engine-neutral `scope:workflows` contract,
the skill workflow task contract, and the other approved skill dependencies. It never imports an
app, Prisma adapter, HTTP router, Kubernetes adapter, controller implementation, or workflow-engine
vendor adapter.

## See also

- Parent: [workflows](../README.md)
- Siblings: [task contract](../contract/README.md) · [controller](../../../controller/README.md)
