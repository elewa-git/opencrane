# @opencrane/backend/agents/runtime/controller — warm runtime activation

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › controller

This infrastructure library projects the saved AgentRun workflow onto one fixed warm-runtime pool.

## What it owns

Helm keeps generic agent-runtime Pods ready. The AgentRun workflow reserves one exact Pod in the
database, then this package activates its fixed network profile, proves readiness, observes its
lifecycle, and deletes that exact UID after use. A Deployment creates the next generic replacement.

```text
Helm-owned generic Deployment
       │
       ▼
list exact candidates → database reservation → activate profile → readiness proof
                                                              │
                                                              ▼
                                                    delete used Pod by UID
```

Tier 2 uses the same `WarmRuntimeKubernetesStore` port. Its development adapter represents each pool
with one synthetic Pod and starts the existing Python runtime process only after the workflow saves
that Pod reservation. This preserves the durable 0.10 workflow and binding path without pretending a
local process is a Kubernetes Job.

## Public surface

- `__CreateWarmRuntimeKubernetesStore(options)` creates the production Kubernetes adapter.
- `__CreateLocalProcessWarmRuntimeStore(options)` creates the Tier 2 process adapter.
- `__CreateLocalAgentRuntimeTokenReviewer(options)` authenticates a synthetic Pod UID from a private
  per-session launch secret.
- `WarmRuntimeKubernetesStore` defines list, activate, readiness, observation, and deletion.
- `WarmRuntimePoolProfiles` maps each server-selected profile to one fixed pool.
- `__AssertWarmRuntimeTiming` checks the claim and pool-miss latency budgets.

## Safety rules

- Production candidates must belong to the configured Deployment and one of its ReplicaSets.
- Namespace, ServiceAccount, profile, Pod UID, and resource version must match.
- Activation changes only the fixed network-profile label.
- Deletion uses the Pod UID, so a replacement with the same name is not deleted.
- Every production Kubernetes call and readiness probe has a short timeout.
- Tier 2 child processes receive an allowlisted environment containing private file paths, never
  controller tokens, provider credentials, or launch-secret contents.
- Each Tier 2 synthetic Pod has its own `0600` token and public proof-evidence path.

## Boundary

This package does not read Postgres, save run state, create production Deployments, select images, or
mint model credentials. Helm owns the production pool. The run package owns database authority. The
workflow handler owns step order and retries.

## Dependency direction

Tagged `scope:agent-runtime-controller` and `layer:infra`; it may depend on warm-pool definitions,
shared contracts, observability, and the pure Tier 2 model-strategy vocabulary. It never imports
Prisma or an application entrypoint.

## See also

- [Runtime package](../README.md)
- [Warm pool definitions](../k8s-launcher/README.md)
- [AgentRun workflow handler](../../execution/runs/controller/README.md)
- [Agent-controller app](../../../../../apps/agent-controller/README.md)
