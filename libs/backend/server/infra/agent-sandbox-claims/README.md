# @opencrane/backend/server/infra/agent-sandbox-claims — deterministic computer leases

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › agent-sandbox-claims

## What it owns

This package turns an already-admitted ConversationComputer generation into exactly one
Agent Sandbox `SandboxClaim`. It creates the release-policy-safe resource body, including the
four Pod labels that preserve the server release boundary and identify that computer, and treats
an already-existing claim as idempotent only when every immutable lease field matches exactly.

```
 durable computer activation
             │ admitted generation + shutdown deadline
             ▼
 ┌─────────────────────────────────┐
 │ agent-sandbox-claims  ◄── HERE   │
 └──────────────┬──────────────────┘
                │ create / exact claim, Sandbox, and Pod get
                ▼
       Agent Sandbox SandboxClaim
```

## Public surface

`__AgentSandboxClaimName` derives the one claim name an admitted computer generation may use. Both
the Kubernetes adapter and the computer authority use it before create/get I/O, so a history record
cannot point at a second claim name.

- `AgentSandboxClaimAuthority` exposes `ensure` as the sole claim-creation operation.
- `_KubernetesAgentSandboxClaimAuthority` calls only namespaced custom-object `create` and `get`.
- `AgentSandboxClaimObservationReader` separately reads one exact claim status and exposes a
  Sandbox id only when its immutable lease fields, stamped Pod labels, and current `Ready=True`
  condition match.
- `AgentSandboxRuntimePodReader` resolves the assigned Sandbox's v1 name-matched backing Pod, then
  accepts it only when its namespace, ServiceAccount, controller owner reference, and immutable UID
  all match the release-bound realization.
- `AgentSandboxClaimReason` restricts claims to activation or recovery.

## Boundary

The caller must authorise the computer action, fence its generation, choose an admitted profile,
and persist durable intent before calling this adapter. This adapter neither authorises a caller,
selects a profile, patches claims, or implements a Pod controller. It reads the one
claim-assigned Sandbox and backing Pod only to preserve a durable lease fence; the cluster-wide
Agent Sandbox controller remains the sole reconciler for sandbox resources.

## Dependency direction

Tagged `scope:agent-sandbox-claims` at the infra layer, this package imports only shared
observability and Kubernetes API error normalisation. It must not import a backend domain, Prisma,
or an app entrypoint.

## Runtime & config

The composing server supplies its own Kubernetes `CustomObjectsApi` and `CoreV1Api`. The server's
release-scoped Role allows `create`/`get` on `sandboxclaims` and `get` on `sandboxes` and `pods`.
The server performs only claim-derived, name-bound reads and never lists, watches, or mutates those
resources. The Kubernetes admission policy rejects any resource body outside the generated immutable
claim shape.

## See also

- Parent index: [infra](../README.md)
- Release boundary: [Agent Sandbox chart](../../../../../apps/_infra/agent-sandbox/README.md)
