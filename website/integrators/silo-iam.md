# Silo IAM

OpenCrane resolves **membership before grants** and freezes the accepted evidence into each
run. Grants can narrow what an agent may do, but cannot manufacture organisation membership.

> See also: [Organisation boundary](/operators/organisation-boundary) (silo identity),
> [Central authorization authority](/integrators/authorization-authority) (transaction-bound product decisions),
> [Governed agent runtime](/integrators/agent-runtime) (run authority), and
> [Long-term memory, Cognee and dreaming](/integrators/long-term-memory-cognee) (memory RBAC).

## Decision order

```text
authenticated subject
       │
       ▼
current silo membership
       │
       ▼
actor grants ∩ agent revision ceiling ∩ run ceiling
       │
       ▼
capability, resource and boundary decision
       │
       ▼
frozen run evidence
```

Membership evidence must name the same silo and subject as the authorisation request.
Stale, missing or unverifiable evidence denies the request.

## Grant composition

OpenCrane calculates effective access for the actor that actually performs the action. A personal
agent uses its human Principal's grants intersected with its revision and run limits. A managed
agent uses its own `AgentService` Principal grants intersected with its revision and run limits. The
human who invokes or administers a managed agent needs a separate management permission.

| Input | Purpose |
|---|---|
| Organisation membership | Establishes that the subject belongs to the `ClusterTenant` |
| Human grants | Bound direct human actions and personal-agent execution |
| Managed AgentService grants | Bound autonomous managed-agent execution |
| Resource boundary | Selects an exact group or personal boundary; group coverage can include descendants |
| Membership revision | Makes the accepted decision auditable |

## Run admission

The input compiler records the effective contract digest, identity snapshot, model route,
integration assignments, skill revisions, memory policy and capability-set digest in one
`RunInputSnapshot`. The runtime receives compiled literals, not a live grant evaluator. The snapshot
is a ceiling: OpenCrane rechecks current membership, grants, cancellation, and resource eligibility
before admitting the next external effect.

::: warning
Never treat a cached group, Kubernetes namespace or runtime claim as current silo membership.
Membership authority is checked before a run is admitted and uncertainty fails closed.
:::

## Sharing

Resource shares create exact recipient grants. They and other group or principal grants change
future authorisation decisions; they do not rewrite
snapshots or events belonging to already accepted runs.

Source: [`libs/backend/server/iam/authorization/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/iam/authorization/main/README.md)
and [`libs/backend/agents/execution/inputs/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/inputs/main/README.md).
