# @opencrane/backend/agents/runtime/workloads/k8s-controller — exact governed Jobs

> [backend](../../../../README.md) › [agents](../../../README.md) › [runtime](../../README.md) › [workloads](../README.md) › Kubernetes controller

## What it owns

This package contains the Kubernetes mechanics that every class-specific governed Job may share:
create or adopt one exact suspended Job, release only its saved immutable UID, accept only its
single exact first Pod, and delete only that saved UID. The skill, OCI MCP, and artifact controllers
supply different Job manifests, profiles, labels, and database claims while using the same checks.
Only a class-specific durable owner decides when deletion is allowed.

```text
class-specific expected Job + saved UID
        │
        ▼
┌──────────────────────────────────┐
│ governed Job controller ◄── HERE │
└──────────────────────────────────┘
        │ exact Job release + first Pod + UID-fenced delete
        ▼
class-specific server authority records the binding
```

## Public surface

- `__CreateKubernetesGovernedJobControllerStore` creates the exact Job adapter.
- `GovernedJobControllerStore` exposes suspended creation, fenced release, first-Pod lookup, and
  UID-fenced idempotent deletion.
- The Batch and Core API types expose only the Kubernetes calls this adapter needs.

## Boundary

The package does not choose a workload, image, namespace, ServiceAccount, label, or database row. It
does not poll for work, own a workflow task, read an OCI archive, or execute MCP. A class-specific
controller supplies the complete expected manifest, persists every claim and binding decision, and
calls deletion only after its durable lifecycle says the Job is finished.

## Dependency direction

Tagged `scope:runtime-workloads` and `layer:infra`, this package depends only on Kubernetes client
types and shared observability. Class-specific skill and MCP controller packages may depend on it;
it never depends on those workload classes or on a deployable app.

## See also

- Shared claim: [workload contract](../contract/README.md)
- MCP Job: [MCP executor launcher](../../mcp-executor/k8s-launcher/README.md)
- Existing skill controller: [skills/controller](../../../skills/controller/README.md)
