# @opencrane/backend/agents/runtime/controller — warm Pod operations

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › controller

## What it owns

This package performs the Kubernetes operations used by the AgentRun workflow. A **workflow** is a
saved task that can continue after a restart.

Helm keeps a small pool of generic agent-runtime Pods ready. When an AgentRun needs one, the workflow
reserves a Pod in the database and asks this package to activate that exact Pod.

```text
 Helm-owned generic Deployment
        │ keeps replacement Pods ready
        ▼
 ┌──────────────────────────────────┐
 │ warm runtime controller ◄── HERE │
 │ list and check generic Pods      │
 └──────────────────────────────────┘
        │ database reserves one UID
        ▼
 change its network profile with UID and version checks
        │
        ▼
 probe readiness through the claimed path
        │ run finishes
        ▼
 delete that exact Pod by UID
```

**In this flow:** [pool definitions](../k8s-launcher/README.md) · [workflow handler](../../execution/runs/controller/README.md)

Deleting the used Pod makes the Deployment create a fresh generic replacement. A used Pod never
returns to the pool.

## Public surface

- `__CreateWarmRuntimeKubernetesStore(options)` creates the Kubernetes adapter.
- `WarmRuntimeKubernetesStore` defines list, activate, readiness, current-Pod observation, and delete
  operations.
- `WarmRuntimePoolProfiles` maps each server-selected runtime profile to one fixed Helm pool.
- `__AssertWarmRuntimeTiming` checks the claim and pool-miss latency budgets.

## Safety rules

- Candidate Pods must belong to the configured Deployment and one of its ReplicaSets.
- The namespace, ServiceAccount, generic profile, Pod UID, and resource version must match.
- Activation changes only the fixed network-profile label.
- Readiness is checked after activation.
- Deletion uses the Pod UID, so a replacement with the same name is not deleted.
- Every Kubernetes call and readiness probe has a short timeout.

## Boundary

This package does not read Postgres, save run state, create Deployments, select images, or mint
credentials. Helm owns the pool. The run package owns database authority. The workflow handler owns
step order and retries.

It does not run arbitrary OCI images. MCP and code-skill executors may reuse the workload-claim
pattern, but they require their own fixed executor and pool profile.

## Dependency direction

Tagged `scope:agent-runtime-controller` and `layer:infra`: it may depend on warm-pool definitions,
shared contracts, and observability. It never imports Prisma or an application entrypoint.

## Runtime and permissions

The controller reads Deployments, ReplicaSets, and Pods; conditionally patches the profile label;
and deletes an exact Pod by UID. Helm creates the Deployment, ServiceAccount, network policy, and
role bindings.

## See also

- [Runtime package](../README.md)
- [Warm pool definitions](../k8s-launcher/README.md)
- [AgentRun workflow handler](../../execution/runs/controller/README.md)
- [Agent-controller app](../../../../../apps/agent-controller/README.md)
