# @opencrane/backend/server/infra/agent-sandbox-claims — deterministic computer leases

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › agent-sandbox-claims

## What it owns

This package turns an already-admitted ConversationComputer generation into exactly one
Agent Sandbox `SandboxClaim`. It creates the release-policy-safe resource body, and treats an
already-existing claim as idempotent only when every immutable lease field matches exactly.

```
 durable computer activation
             │ admitted generation + shutdown deadline
             ▼
 ┌─────────────────────────────────┐
 │ agent-sandbox-claims  ◄── HERE   │
 └──────────────┬──────────────────┘
                │ create / exact get on 409
                ▼
       Agent Sandbox SandboxClaim
```

## Public surface

- `AgentSandboxClaimAuthority` exposes `ensure` as the sole application operation.
- `_KubernetesAgentSandboxClaimAuthority` calls only namespaced custom-object `create` and `get`.
- `AgentSandboxClaimReason` restricts claims to activation or recovery.

## Boundary

The caller must authorise the computer action, fence its generation, choose an admitted profile,
and persist durable intent before calling this adapter. This adapter neither authorises a caller,
selects a profile, watches Pods, patches claims, nor implements a Pod controller. The cluster-wide
Agent Sandbox controller remains the sole reconciler for sandbox resources.

## Dependency direction

Tagged `scope:agent-sandbox-claims` at the infra layer, this package imports only shared
observability and Kubernetes API error normalisation. It must not import a backend domain, Prisma,
or an app entrypoint.

## Runtime & config

The composing server supplies its own Kubernetes `CustomObjectsApi`. The server's release-scoped
Role admits only `create` and `get` on `sandboxclaims`; the Kubernetes admission policy rejects any
resource body outside the generated immutable shape.

## See also

- Parent index: [infra](../README.md)
- Release boundary: [Agent Sandbox chart](../../../../../apps/_infra/agent-sandbox/README.md)
