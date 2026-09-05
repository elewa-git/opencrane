# @opencrane/backend/server/infra/agent-sandbox — Kubernetes sandbox realization

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › agent-sandbox

## What it owns

This package realizes conversation-computer SandboxClaims and verifies the exact Kubernetes Pod bound to an active computer lease. Conversation policy stays in the conversations backend; this package owns only Kubernetes API translation and identity evidence.

## Public surface

- `AgentSandboxClaimAdapter` creates or observes the deterministic claim and returns controller-owned sandbox identity and Service DNS evidence.
- `AgentSandboxPodBindingAdapter` verifies the TokenReviewed Pod UID, ServiceAccount, claim, and copied lease labels.

## See also

- Parent index: [infra](../README.md)
- Workload identity: [workload-identity](../workload-identity/README.md)
