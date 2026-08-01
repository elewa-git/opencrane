# Personal-agent platform architecture

OpenCrane is the durable control plane for personal and managed agents. It records the exact
identity, configuration, input, events, external actions, and outcome of every run while keeping the
model loop replaceable and non-authoritative.

## Authority flow

```text
OIDC subject + signed organisation membership
                    │
                    ▼
        OpenCrane authorization and run admission
                    │
                    ├──► immutable RunInputSnapshot
                    │
                    ▼
          AgentRun + ordered RunEvent stream
                    │
                    ▼
       controller assigns one fenced attempt
                    │
                    ▼
      outbound-only agent-runtime workload
                    │
                    ├──► LiteLLM model call
                    └──► external-action candidate
                                  │
                                  ▼
                     OpenCrane authorizes and executes
```

The canonical run hierarchy is:

```text
Thread
  └── AgentRun
        ├── RunInputSnapshot
        ├── ordered RunEvent
        └── RuntimeAssignment
              └── fenced attempt commands and candidates
```

The database enforces that an `AgentRun` has its exact immutable `RunInputSnapshot`. The input
compiler resolves persona, conversation, memory references, tool policy, model route, budget, and
identity before dispatch; the runtime receives literal compiled input and cannot reinterpret those
authorities.

Source contracts:

- [`libs/contracts/src/run-input-snapshot.types.ts`](../../libs/contracts/src/run-input-snapshot.types.ts)
- [`libs/contracts/src/agent-runtime-protocol.types.ts`](../../libs/contracts/src/agent-runtime-protocol.types.ts)
- [`apps/opencrane/prisma/schema/runs.prisma`](../../apps/opencrane/prisma/schema/runs.prisma)
- [`libs/backend/agents/execution/inputs/main`](../../libs/backend/agents/execution/inputs/main)

## Control-plane ownership

OpenCrane owns every durable or security-sensitive decision:

| Authority | Owner |
|-----------|-------|
| Organisation identity and membership evidence | OIDC plus verified, bounded signed membership evidence |
| Agent definitions and immutable revisions | Agent-service domain |
| Thread, run, input snapshot, and ordered events | Run and conversation domains |
| Persona and preference revisions | Personal-configuration domain |
| Skill publication and assignments | Skill domains |
| Model routes, provider credentials, and budgets | Model and execution authorities |
| Tool grants, approvals, and external actions | IAM and tool-execution authorities |
| Artifact metadata, revisions, and leases | Artifact catalogue and authorization domains |
| Scheduling, retry, cancellation, and terminal state | Managed-run and execution authorities |

An unavailable authority returns a denial or an unavailable outcome. Callers cannot substitute
cached caller input, workload state, or a permissive default.

## Runtime boundary

[`apps/agent-runtime`](../../apps/agent-runtime) implements the current bounded model/tool loop with
the exact-pinned Pydantic AI package. It opens an authenticated outbound stream and accepts fenced
`start_attempt`, `resume_attempt`, and `cancel_attempt` commands.

The runtime:

- has no direct Postgres access or Kubernetes RBAC;
- receives no provider master secret;
- cannot append canonical events directly;
- reports candidates that the control plane validates and persists;
- executes no external action directly; and
- keeps framework types, identifiers, and checkpoints behind the language-neutral protocol.

The controller creates a fresh, suspended Job for an attempt, projects the workload identity, and
releases the Job only after assignment admission. A one-use bootstrap exchange binds the Pod,
assignment, proof key, and credential material. Network policy limits the workload to the required
control-plane and model-proxy paths.

Source implementations:

- [`apps/agent-controller`](../../apps/agent-controller)
- [`apps/agent-runtime`](../../apps/agent-runtime)
- [`apps/managed-agent-runtime`](../../apps/managed-agent-runtime)
- [`libs/backend/agents/execution/protocol`](../../libs/backend/agents/execution/protocol)
- [`libs/server/_infra/agent-runtime-stream`](../../libs/server/_infra/agent-runtime-stream)

## External actions and artifacts

A runtime tool call is only a candidate. OpenCrane checks the immutable snapshot, tool revision,
grant, approval state, idempotency key, and budget before an authorized server-side executor performs
the action. Deferred approvals resume through a single-use token and a fenced `resume_attempt`
command.

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

Postgres and artifact storage are authoritative durable stores. Runtime workspaces are scratch
space: they are not backed up and may disappear when a Pod terminates. Recovery reconstructs work
from canonical run, snapshot, event, assignment, and artifact records.

## Validation

Live cluster and model-proxy exercises validate the implementation under real infrastructure. They
do not change which component owns an authority and do not justify retaining an alternative runtime,
schema, protocol, or deployment path.

> See also: [product contract](personal-agent-platform-product-contract.md),
> [ADR 0005](../adr/0005-opencrane-owned-agent-runtime.md),
> [ADR 0008](../adr/0008-target-agent-contracts-and-workload-identity.md), and
> [ADR 0010](../adr/0010-language-neutral-agent-runtime.md).
