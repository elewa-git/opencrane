# @opencrane/backend/agents/runtime/workloads/k8s-controller — exact governed Jobs

> [backend](../../../../README.md) › [agents](../../../README.md) › [runtime](../../README.md) › [workloads](../README.md) › Kubernetes controller

## What it owns

This package contains the Kubernetes mechanics that every class-specific governed Job must share:
create or adopt one exact suspended Job, release only its saved immutable UID, and accept only its
single exact first Pod. The skill controller and OCI MCP controller supply different Job manifests,
profiles, labels, and database claims while using the same checks. The skill controller uses this
package today; the OCI MCP controller will use it when that controller is composed.

```text
class-specific expected Job + saved UID
        │
        ▼
┌──────────────────────────────────┐
│ governed Job controller ◄── HERE │
└──────────────────────────────────┘
        │ exact Job release + first Pod
        ▼
class-specific server authority records the binding
```

## Public surface

- `__CreateKubernetesGovernedJobControllerStore` creates the exact Job adapter.
- `GovernedJobControllerStore` exposes suspended creation, fenced release, and first-Pod lookup.
- The Batch and Core API types expose only the Kubernetes calls this adapter needs.

## Boundary

The package does not choose a workload, image, namespace, ServiceAccount, label, or database row. It
does not poll for work, own a workflow task, read an OCI archive, execute MCP, or delete a completed
Job. A class-specific controller supplies the complete expected manifest and persists every claim
and binding decision.

## Dependency direction

Tagged `scope:runtime-workloads` and `layer:infra`, this package depends only on Kubernetes client
types and shared observability. Class-specific skill and MCP controller packages may depend on it;
it never depends on those workload classes or on a deployable app.

## See also

- Shared claim: [workload contract](../contract/README.md)
- MCP Job: [MCP executor launcher](../../mcp-executor/k8s-launcher/README.md)
- Existing skill controller: [skills/controller](../../../skills/controller/README.md)
