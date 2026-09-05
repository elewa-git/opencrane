# Architecture

OpenCrane is a **durable authority with replaceable execution**. The system is organised
around organisation silos, immutable conversation history and governed execution.

## Control and execution

```text
                    ┌─────────────────────────────────────┐
                    │ OpenCrane control plane                │
                    │ identity · policy · history · audit    │
                    └─────────────────┬──────────────────┘
                                    │ authorised desired state
                    ┌─────────────────▼──────────────────┐
                    │ KurrentDB + computer authority      │
                    │ stream + generation-fenced lease    │
                    └─────────────────┬──────────────────┘
                                    │ one checked SandboxClaim
                    ┌─────────────────▼──────────────────┐
                    │ conversation computer               │
                    │ leased Pod, no durable authority    │
                    └─────────────────┬──────────────────┘
                                    │ candidates
                    ┌───────────────▼──────────────────┐
                    │ governed external-action custody │
                    └──────────────────────────────────┘
```

The server appends participant-visible history before it activates a computer. It records one
generation-bound lease and creates a checked Agent Sandbox claim; the external controller may only
realise the release-owned Pod profile. The computer receives one frozen pending turn and may propose
an output, but it cannot append history, choose another identity or approve external actions itself.

## Durable conversation model

```text
KurrentDB conversation stream
├── immutable participant-visible entries
├── private-payload references and ciphertext digests
├── membership conditions and safe logs
└── logical ConversationComputer
    ├── resolved AgentIdentity
    ├── admitted profile revision
    └── zero or one generation-fenced live lease
```

PostgreSQL retains rebuildable conversation projections and remains authoritative for current
memberships, grants and deny rules. Separate AgentRun workers still own scheduled, triggered and
child-run execution; their lifecycle is not the conversation-computer Pod lifecycle.

## Personal and managed are separate authorities, not a flag

The architecture treats *personal* and *managed* as two distinct admission and identity paths that
happen to share execution governance, not as one code path with a boolean on
it:

- **Personal admission** resolves the conversation's AgentIdentity and current Principal, then
  records the authenticated person only as requester provenance.
- **Managed admission** resolves its constructed AgentIdentity and own Principal, verifies current
  membership, and intersects the active revision's exact knowledge and tool attachments with
  effective grants — it never resolves a human caller as execution authority.

A personal run always carries an approved `PersonaRevision`; a managed run never does — its
published revision is already its complete instruction set. Both share authorization and audit
conventions, so "what ran and under what authority"
is answered the same way regardless of which path admitted it.

## Isolation

One `ClusterTenant` represents one customer organisation. There is no Kubernetes user resource and
no standing per-user runtime. A conversation computer is bound to its conversation, AgentIdentity,
profile revision, lease and generation. AgentRun workers keep their separate admitted execution
subjects; neither path can borrow the other's authority.

## Shared services

Model routing (via LiteLLM), OCI MCP execution, skill publication, content-addressed
artifacts and organisation memory (via the memory gateway, backed by Cognee) are control-plane
services. They expose narrow, authenticated boundaries and do not become alternate run or policy
authorities. A frozen run snapshot is a maximum; the control plane rechecks current authorization
before admitting the next external effect.

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

→ [Conversation computers](/integrators/agent-runtime) ·
[Central authorization authority](/integrators/authorization-authority) ·
[Governed packages and container images](/integrators/governed-packages) ·
[Organisation boundary](/operators/organisation-boundary) ·
[Running multiple instances](/advanced/multi-instance)
