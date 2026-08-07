# Silo IAM

OpenCrane resolves **membership before grants** and freezes the accepted evidence into each
run. Grants can narrow what an agent may do, but cannot manufacture organisation membership.

> See also: [Organisation boundary](/operators/organisation-boundary) (silo identity),
> [Governed agent runtime](/integrators/agent-runtime) (run authority), and
> [Retrieval and memory](/integrators/retrieval-memory) (dataset binding).

## Decision order

```text
authenticated subject
       │
       ▼
current ClusterTenant membership
       │
       ▼
subject grants ∩ agent-service grants
       │
       ▼
capability, resource and scope decision
       │
       ▼
frozen run evidence
```

Membership evidence must name the same silo, subject and scope as the authorisation request.
Stale, missing or unverifiable evidence denies the request.

## Grant composition

OpenCrane calculates effective access from grants held by both the acting subject and the
agent service. This prevents a broadly configured agent from exceeding the user's rights and
prevents a broadly entitled user from making an under-scoped agent act outside its contract.

| Input | Purpose |
|---|---|
| Organisation membership | Establishes that the subject belongs to the `ClusterTenant` |
| Subject grants | Bounds what the person may delegate |
| Agent-service grants | Bounds what the agent definition may exercise |
| Resource and scope | Selects the exact capability being decided |
| Membership revision | Makes the accepted decision auditable |

## Run admission

The input compiler records the effective contract digest, identity snapshot, model route,
integration assignments, skill revisions, memory policy and capability-set digest in one
`RunInputSnapshot`. The runtime receives compiled literals, not a live grant evaluator.

::: warning
Never treat a cached group, Kubernetes namespace or runtime claim as current membership.
Membership authority is checked before a run is admitted and uncertainty fails closed.
:::

## Sharing

Direct shares and group grants change future authorisation decisions. They do not rewrite
snapshots or events belonging to already accepted runs.

Source: [`libs/backend/server/iam/authorization/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/iam/authorization/main/README.md)
and [`libs/backend/agents/execution/inputs/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/inputs/main/README.md).
