# Architecture

OpenCrane is a **durable authority with replaceable execution**. The system is organised
around organisation silos, immutable agent revisions and governed run attempts.

## Control and execution

```text
                    ┌──────────────────────────────────┐
                    │ OpenCrane control plane          │
                    │ identity · policy · runs · audit │
                    └───────────────┬──────────────────┘
                                    │ authorised desired state
                    ┌───────────────▼──────────────────┐
                    │ agent controller                 │
                    │ exact Kubernetes projection      │
                    └───────────────┬──────────────────┘
                                    │ claim one warm Pod per attempt
                    ┌───────────────▼──────────────────┐
                    │ agent runtime                    │
                    │ bounded loop, no durable state   │
                    └───────────────┬──────────────────┘
                                    │ candidates
                    ┌───────────────▼──────────────────┐
                    │ governed external-action custody │
                    └──────────────────────────────────┘
```

The server admits a run and freezes its accepted inputs before a warm Pod receives attempt authority
or execution material. The controller can project only the assigned workload shape. The runtime can emit candidates,
but it cannot approve or execute external actions by itself.

## Durable run model

```text
Conversation (`agent_session`; optional run parent)
└── AgentRun
    ├── immutable AgentRevision
    ├── one RunInputSnapshot
    ├── attempt 1..n
    ├── ordered RunEvent records
    ├── workload and proof evidence
    ├── approvals and action receipts
    └── terminal outcome and cost
```

Retries advance the attempt counter on the same logical run. Child runs are separate
`AgentRun` records with a durable parent reservation and bounded inherited budget.

## Personal and managed are separate authorities, not a flag

The architecture treats *personal* and *managed* as two distinct admission and identity paths that
happen to share the same runtime and execution machinery, not as one code path with a boolean on
it:

- **Personal admission** derives its `AgentService` through the caller's own participant-bound
  conversation admission and verifies exactly one signed personal membership assertion — the
  caller can only ever admit a run as themselves.
- **Managed admission** derives the canonical `agent-service:<id>` principal, verifies its current
  Ed25519-signed fleet membership, and intersects the active revision's exact knowledge and tool
  attachments with effective grants — it never resolves a human caller's identity at all.

A personal run always carries an approved `PersonaRevision`; a managed run never does — its
published revision is already its complete instruction set. Both share one run-admission capacity
gate, one execution/runtime substrate, and one audit trail, so "what ran and under what authority"
is answered the same way regardless of which path admitted it.

## Isolation

One `ClusterTenant` represents one customer organisation. Its trusted server and runtime
namespaces are distinct. There is no Kubernetes user resource and no standing per-user runtime.
Personal work is bound through the admitted run's subject and immutable evidence; managed work is
bound through its own service identity and signed fleet membership — neither can borrow the
other's authority.

## Shared services

Model routing (via LiteLLM), OCI MCP execution, skill publication, content-addressed
artifacts and organisation memory (via the memory gateway, backed by Cognee) are control-plane
services. They expose narrow, authenticated boundaries and do not become alternate run or policy
authorities — a personal or managed run only ever reaches them through the frozen, admitted
snapshot for that run.

## Module structure

Server-side capabilities are organised as focused, independently buildable libraries rather than
one large backend package — tenancy, IAM (identity, membership, grants, groups, policies,
authorization, audit), knowledge, gateways (MCP, model routing, providers, integrations), agent
definitions and scheduling, personal configuration/memory/personas, execution (admission, inputs,
runs), skills and artifacts each own their routes, types and Prisma schema slice. An
`@nx/enforce-module-boundaries` lint rule keeps imports flowing in one direction — a capability may
depend on its own scope, `scope:shared`, and explicitly approved peers, never a silent cross-domain
shortcut. See [`docs/agents/monorepo.md`](https://github.com/elewa-git/opencrane/blob/main/docs/agents/monorepo.md)
for the full placement and dependency rules.

→ [Governed agent runtime](/integrators/agent-runtime) ·
[Organisation boundary](/operators/organisation-boundary) ·
[Running multiple instances](/advanced/multi-instance)
