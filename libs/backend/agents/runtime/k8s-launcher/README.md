# @opencrane/backend/agents/runtime/k8s-launcher — warm pool definitions

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › k8s-launcher

## What it owns

This package defines and checks one Helm-owned warm runtime pool. It contains no Kubernetes client.

```text
 fixed Helm values
   │ namespace, Deployment, image digest, ServiceAccount, profiles, resources
   ▼
 ┌──────────────────────────────────┐
 │ warm pool definitions ◄── HERE   │
 │ check WarmRuntimePoolProfile     │
 └──────────────────────────────────┘
   │
   ├── build selector for generic Pods
   └── check candidate Pod identity and owner chain
```

**In this flow:** [runtime controller](../controller/README.md) · [workflow handler](../../execution/runs/controller/README.md)

A generic Pod has no run, user, model key, or uploaded image. The workflow can change only its fixed
network profile after the database reserves its exact UID.

## Public surface

- `__AssertWarmRuntimePoolProfile(profile)` checks names, the pinned image digest, ports, lifetime,
  scratch size, and CPU and memory settings.
- `__WarmRuntimeGenericPodSelector(profile)` builds the selector for the generic pool.
- `__WarmRuntimePodCandidate(pod, profile, deploymentUid, replicaSetUids)` checks a Pod before it can
  be offered for database reservation.
- `WarmRuntimePoolProfile`, `WarmRuntimePodCandidate`, and `WarmRuntimePodIdentity` describe the fixed
  pool and exact Pod identity.

## Boundary

The package does not call Kubernetes, read the database, create a workload, or decide which run gets
a Pod. Helm owns the pool. The runtime controller performs Kubernetes calls. The AgentRun workflow
orders the durable claim, activation, readiness, work, and cleanup steps.

This profile is for the standard agent runtime image. It cannot be changed into an uploaded OCI MCP
or code-skill image. Those workload classes need their own executor profile.

## Dependency direction

Tagged `scope:agent-runtime-launcher` and `layer:infra`: it may depend only on Kubernetes types and
shared contracts. It never imports Prisma, a Kubernetes client, or an application entrypoint.

## Runtime settings

The caller supplies a digest-pinned image, namespace, Deployment, ServiceAccount, generic and claimed
profiles, binding port, generic idle time, scratch size, and CPU and memory settings. All of these are
deployment-owned values; a run cannot replace them.

## See also

- [Runtime package](../README.md)
- [Warm Kubernetes controller](../controller/README.md)
- [AgentRun workflow handler](../../execution/runs/controller/README.md)
- [Agent-runtime process](../../../../../apps/agent-runtime/README.md)
