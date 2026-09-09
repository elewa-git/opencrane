# Personal-agent platform architecture

OpenCrane gives employees and teams assistants that use permitted company knowledge and tools.
The company controls access, data and spending. People work in conversations; the server keeps
their work recoverable and decides what each person and assistant may do.

This page describes the 0.11 review baseline and the boundaries later capabilities must retain.
The [active plan](../../plan.md) separates implemented work from MVP gaps and live qualification.
The [website overview](../../website/advanced/architecture.md) introduces the same architecture
without source-level detail. [ADR 0016](../adr/0016-conversation-history-and-computers.md) controls
the conversation-computer replacement.

## Authority flow

```text
Browser session + current PostgreSQL membership and grants
                    │
                    ▼
      OpenCrane checks the requested action
                    │
                    ├──► direct/group Message (no run)
                    ├──► KurrentDB conversation history
                    └──► agent_session only
                              │
                              ▼
                    durable activation request
                    │
                    ▼
       Agent Sandbox creates and owns the computer Pod
       OpenCrane verifies the active computer lease
                    │
                    ▼
       recheck authority and admit the serial turn
       freeze its immutable RunInputSnapshot
                    │
                    ▼
      conversation-computer runtime
                    │
                    ├──► LiteLLM model call
                    └──► external-action candidate
                                  │
                                  ▼
                     governed tool executor (model-loop wiring pending)
```

The canonical conversation and conditional run hierarchy is:

```text
Conversation (immutable mode) -> ordered KurrentDB conversation-{id} stream
  └── agent_session only
        └── ConversationComputer -> AgentRun
              ├── RunInputSnapshot
              └── fenced attempt commands and candidates
```

Direct and ordinary group messages never create runs. The database enforces that an `AgentRun` has
its exact immutable `RunInputSnapshot`. The input compiler resolves persona, conversation, memory
references, tool policy, model route, budget, and identity before dispatch; the runtime receives
literal compiled input and cannot reinterpret those authorities.
[ADR 0012](../adr/0012-conversation-modes-and-agent-thread-authority.md) records the mode,
lifecycle and child-chat requirements. ADR 0016 replaces its older runtime and storage mechanisms.

Source contracts:

- [`libs/contracts/src/run-input-snapshot.types.ts`](../../libs/contracts/src/run-input-snapshot.types.ts)
- [`libs/contracts/src/conversation-computer.types.ts`](../../libs/contracts/src/conversation-computer.types.ts)
- [`apps/opencrane/prisma/schema/runs.prisma`](../../apps/opencrane/prisma/schema/runs.prisma)
- [`libs/backend/agents/execution/inputs/main`](../../libs/backend/agents/execution/inputs/main)

## Control-plane ownership

OpenCrane owns every durable or security-sensitive decision:

| Authority | Owner |
|-----------|-------|
| Current authorization | PostgreSQL membership and central authorization policy; OIDC supplies the authenticated subject |
| Agent definitions and immutable revisions | Agent-service domain |
| Ordered conversation and computer history | Separate KurrentDB streams owned by the conversation domain |
| Turn admission and immutable inputs | Conversation and execution domains, checked against current PostgreSQL authority |
| Persona and preference revisions | Personal-configuration domain |
| Skill publication and assignments | Skill domains |
| Model routes, provider credentials, and budgets | Model and execution authorities |
| Tool grants, approvals, and external actions | IAM and tool-execution authorities |
| Artifact metadata, revisions, and leases | Artifact catalogue and authorization domains |
| Managed scheduling | Completion track; removed execution routes are not supported in the baseline |
| Computer lifetime | OpenCrane owns activation, leases and checkpoints; Agent Sandbox owns Pods |

An unavailable authority returns a denial or an unavailable outcome. Callers cannot substitute
cached caller input, workload state, or a permissive default.

## Runtime boundary

[`apps/conversation-computer`](../../apps/conversation-computer) implements a bounded model turn
inside the computer claimed for an assistant conversation. Approved persona instructions and
conversation history reach the model. Connecting model tool requests to the existing governed
executor remains pending. The server admits work against the active lease generation and
canonical history.

The runtime:

- has no direct Postgres access or Kubernetes RBAC;
- receives no provider master secret;
- cannot append canonical events directly;
- reports candidates that the control plane validates and persists;
- executes no external action directly; and
- keeps framework types, identifiers, and checkpoints behind the language-neutral protocol.

The server creates one Agent Sandbox claim for an admitted conversation computer. Cooling persists a
checkpoint before releasing that claim; a later message either reactivates the same lease or claims
the next fenced generation from the durable checkpoint. Network policy limits the computer to its
required control-plane and model-proxy paths.

Source implementations:

- [`apps/conversation-computer`](../../apps/conversation-computer)
- [`libs/backend/server/conversations/main`](../../libs/backend/server/conversations/main)
- [`libs/backend/server/infra/agent-sandbox`](../../libs/backend/server/infra/agent-sandbox)

## External actions and artifacts

The tool-execution target keeps model suggestions separate from authority. OpenCrane checks the
immutable snapshot, tool revision, grant, approval, idempotency and budget before a server-owned
executor receives scoped credentials. The executor foundations exist; a complete model-to-tool,
approval and durable-result journey still needs implementation and qualification.

Artifact bytes are likewise brokered. The catalogue resolves the exact active revision, the
authorization library signs a short-lived read lease, and
[`apps/artifact-service`](../../apps/artifact-service) serves the lease-bound bytes through its fixed
private endpoint. Untrusted workloads do not receive storage addresses, signing keys, or
list-by-address capabilities. [ADR 0011](../adr/0011-single-run-input-and-artifact-read-authorities.md)
records this boundary.

## Isolation and durability

Each `ClusterTenant` maps to an isolated silo. Namespace, service-account, network-policy, database,
and object-storage boundaries prevent cross-silo reachability. The control plane applies deny by
default and validates the silo coordinate again at each storage and workload boundary.

PostgreSQL owns current authorization and relational product state. KurrentDB owns immutable
conversation and computer history. Artifact storage owns retained file bytes. Computer checkpoints
preserve workspace files across cooling and Pod replacement; those files never grant authority or
replace canonical history. A successful recovery requires the related durable stores to agree.

The baseline supports fresh installation only. Backup and restore scripts exist, but the requested
testv5 recovery drill is not complete; see the [deployment ledger](../agents/deploy-ledger.md).

## Validation

Live cluster and model-proxy exercises validate the implementation under real infrastructure. They
do not change which component owns an authority and do not justify retaining an alternative runtime,
schema, protocol, or deployment path.

> See also: [product contract](personal-agent-platform-product-contract.md),
> [ADR 0005](../adr/0005-opencrane-owned-agent-runtime.md),
> [ADR 0008](../adr/0008-target-agent-contracts-and-workload-identity.md), and
> [ADR 0010](../adr/0010-language-neutral-agent-runtime.md).
