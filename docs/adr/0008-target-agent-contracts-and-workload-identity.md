# ADR 0008 — Agent contracts and workload identity

- **Status:** Accepted; artifact-read and prompt-compiler placement clarified by
  [ADR 0011](0011-single-run-input-and-artifact-read-authorities.md); the universal `Thread` aggregate
  and run-hierarchy clause superseded by [ADR 0012](0012-conversation-modes-and-agent-thread-authority.md);
  the Job-only runtime-controller clause superseded by
  [ADR 0014](0014-claimed-warm-runtime-pool.md)
- **Date:** 2026-07-18
- **Task:** `#245`
- **Related:** [product contract](../design/personal-agent-platform-product-contract.md) ·
  [platform architecture](../design/personal-agent-platform-architecture.md) ·
  [ADR 0012](0012-conversation-modes-and-agent-thread-authority.md) ·
  [ADR 0014](0014-claimed-warm-runtime-pool.md)

## Context

Schemas, APIs, policies, and workloads need one vocabulary for personal and managed agents.
Durable product authorities must remain distinct from replaceable execution workloads, while every
cross-boundary request carries a verifiable organisation, subject, run, and revision identity.

## Decision

### Durable authority

Postgres is authoritative for agent services and revisions, threads, messages, runs, immutable input
snapshots, ordered events, approvals, persona revisions, artifact and skill metadata, grants,
assignments, schedules, budgets, and audit evidence. Canonical artifact bytes sit behind
`ArtifactStore`; scoped memory records retain explicit dataset identity and provenance.

The run hierarchy is `Thread -> AgentRun -> ordered RunEvent`. A run binds one exact
`AgentRevision` and one immutable `RunInputSnapshot`. Runtime workloads receive compiled input and
submit candidates; they do not mutate product records directly.

### Authorization

Projects are independent of departments and teams. Grant evaluation selects the highest applicable
priority and applies `Deny` when an `Allow` and `Deny` share that priority. Derived dataset or access
projections never become authority.

Membership evidence is accepted only when issuer, signature, silo, subject, revision, issue time,
and expiry validate. OpenCrane trusts the highest verified revision within its configured freshness
bound. Missing, stale, mismatched, replayed, or lower revisions fail closed.

### Workload identity

Every workload class has a fixed owner, service account, projected token audience, namespace, and
network profile. Default service-account token automount is disabled. A workload receives Kubernetes
API access only when its owner requires explicit verbs.

The [`agent-controller`](../../apps/agent-controller) is the sole mutator of runtime Jobs. Personal
and managed runtime Pods have no Kubernetes RBAC. Assignment admission binds the Pod UID, namespace,
service account, audience, run, attempt, agent revision, silo, and subject before a one-use bootstrap
exchange returns scoped execution material.

| Workload | Identity and authority |
|----------|------------------------|
| [`apps/opencrane`](../../apps/opencrane) | Control-plane API; owns product composition and database access |
| [`apps/channel-proxy`](../../apps/channel-proxy) | Channel ingress boundary; no product database authority |
| [`apps/agent-controller`](../../apps/agent-controller) | Runtime-namespace Job mutation only |
| [`apps/agent-runtime`](../../apps/agent-runtime) | Projected personal-runtime identity; no RBAC or database access |
| [`apps/managed-agent-runtime`](../../apps/managed-agent-runtime) | Projected managed-runtime identity; no RBAC or database access |
| [`apps/artifact-service`](../../apps/artifact-service) | Private immutable-byte service behind signed leases |
| [`apps/artifact-preprocessor`](../../apps/artifact-preprocessor) | Assigned artifact-processing Job with brokered bytes |
| [`apps/skill-authoring`](../../apps/skill-authoring) | Assigned skill-authoring Job with brokered inputs |
| [`apps/tool-runner`](../../apps/tool-runner) | Sandboxed non-integration tool Job with capability-scoped egress |

### Storage

Durable stores use explicitly mounted persistent volumes and backup coverage. Runtime workspaces are
lease-scoped scratch storage, are not authoritative, and may be cleared on Pod replacement,
scale-to-zero, or lease expiry.

## Alternatives considered

- **Let runtime workloads own transcripts or checkpoints** — rejected because recovery and audit
  would depend on ephemeral state.
- **Give each runtime Kubernetes mutation rights** — rejected because workload creation and
  assignment admission need one controller authority.
- **Use network location as authorization** — rejected because reachability does not prove the
  subject, run, revision, action, or resource.
- **Store durable user state in runtime workspaces** — rejected because workload storage is scratch.

## Consequences

- Every new workload needs a named app owner, projected identity, explicit network destinations, and
  a documented durable-authority boundary.
- Control-plane admission persists canonical evidence before clients or workloads rely on it.
- Runtime and worker compromise does not grant direct access to product databases, Kubernetes
  mutation, provider master credentials, or storage addresses.
- Contract tests use the independent
  [acceptance fixtures](../design/personal-agent-platform-phase-c-acceptance-fixtures.json).
