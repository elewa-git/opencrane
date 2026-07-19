# ADR 0009 — OpenSandbox as the sandbox-job execution substrate

- **Status:** Accepted
- **Date:** 2026-07-18
- **Task:** user-directed OpenSandbox scheduling and agent-runtime documentation
- **Amends:** [ADR 0008](0008-target-agent-contracts-and-workload-identity.md)
- **Related:**
  [`personal-agent-platform-architecture.md`](../design/personal-agent-platform-architecture.md) ·
  [`openclaw-agent-loop-replacement-plan.md`](../design/openclaw-agent-loop-replacement-plan.md)

## Context

OpenCrane must execute tenant-authored Python, generated documents, code, and other non-MCP tools
without giving the conversational runtime a durable workspace, broad credentials, or Kubernetes
mutation rights. Plain Kubernetes Jobs supply scheduling and process isolation, but OpenCrane would
still have to build and maintain command/file/code streaming, sandbox TTL, endpoint handling,
resource profiles, egress enforcement, and deletion diagnostics.

OpenSandbox already exposes protocol-first lifecycle and execution APIs, a Kubernetes provider, an
in-sandbox `execd` daemon with streamed command and code output, egress policy components, resource
limits, TTLs, and secure runtime-class support. Its full platform also exposes authorities OpenCrane
must not delegate: a tenant-visible lifecycle surface, runtime policy mutation, persistent
snapshots/volumes, MCP access, and optional credential injection.

ADR 0008 made `apps/agent-controller` the sole agent-workload mutation boundary. Using the complete
OpenSandbox Kubernetes lifecycle service unchanged would create a second broad mutator and would
mistake its shared API-key authentication for tenant identity. The useful execution substrate must
therefore be adopted behind a narrower OpenCrane boundary.

## Decision

- Adopt one exact-pinned OpenSandbox release in Phase E as the execution substrate for non-Obot
  sandbox Jobs. Phase D first lands the app boundary, adapter contract, identity, RBAC, admission,
  network, and persistence constraints.
- Keep the substrate-neutral `SandboxJobExecutor`, proof-bound assignment mapping, and conformance
  harness in `libs/backend/agents/sandbox-execution/main`; the three app roots remain thin
  composition/deployment owners and no library imports an app.
- `apps/tool-runner` owns the approved workload images and execution profiles. It has zero
  Kubernetes RBAC, no default service-account token, scratch-only storage, an immutable input
  assignment, resource/deadline limits, and only capability-declared network destinations.
- `apps/_infra/opensandbox` owns the pinned upstream lifecycle server, Kubernetes provider, `execd`,
  and egress components. Its Kubernetes permissions and watches are confined to the sandbox
  namespace and named workload types. It is a delegated sandbox mutator, not a general controller.
- `apps/agent-controller` remains the sole OpenCrane workload mutator and the only caller allowed to
  reach the OpenSandbox lifecycle API. The API has no public ingress and is unreachable from agent
  and sandbox workloads. Its upstream API key authenticates only this internal hop; OpenCrane
  validates the silo, actor, run, revision, action, arguments digest, proof, expiry, and replay state
  before making it. The key is unavoidable only because the pinned upstream server does not validate
  OpenCrane projected workload identity; it is stored and rotated as an app-owned Secret, and is
  removed when the upstream or a validating mTLS/workload-identity front door supports that trust
  directly.
- OpenCrane owns `AgentRun`, attempts, approvals, scheduling, cancellation, recovery, canonical
  `RunEvent`s, audit, and `ArtifactStore`. OpenSandbox lifecycle state is an execution projection.
  Its SSE/exec output is untrusted input relayed by `apps/agent-controller` as fenced, idempotent
  candidates to the OpenCrane internal run-ingest API. Only `apps/opencrane` normalizes and persists
  canonical events before UI publication; OpenSandbox and runtimes have no Postgres path.
- Each sandbox receives an attenuated, attempt-scoped delegation of the spawning agent's authority.
  OpenCrane computes it as the intersection of the initiating actor/AgentService grants, immutable
  run and AgentRevision, exact approved action and arguments digest, ArtifactVersion and egress
  grants, and the sandbox profile ceiling. The capability is proof-bound to the silo, run, attempt,
  sandbox workload identity, expiry, and replay record. It cannot grant anything the agent lacked,
  and no agent, provider, Obot, or other ambient credential is copied into the workload.
- Obot remains the MCP credential custodian and execution PEP. The initial OpenSandbox profile does
  not expose its MCP server, CLI, credential vault, host volumes, persistent volumes, pause/resume,
  or reusable snapshots. Sandbox outputs become durable only through an authorized ArtifactStore
  finalize.
- Egress policy is rendered from the approved action capability before sandbox creation. A sandbox
  cannot reach the lifecycle API or mutate its egress policy. Production profiles require
  default-deny Cilium policy, dropped capabilities, read-only roots where possible, explicit
  seccomp/admission rules, and a qualified gVisor or Kata RuntimeClass. Production fails closed and
  does not execute untrusted sandbox work when that class is unavailable; ordinary `runc` is
  permitted only in a local test profile with no tenant inputs or production credentials.
- Completion, cancellation, timeout, crash recovery, and garbage collection must verify sandbox
  deletion. A retry or approval resume creates a new recorded attempt and sandbox; it never silently
  reuses an execution whose side-effect state is ambiguous. The new attempt receives a new proof;
  old-attempt, cross-silo, and wrong-workload replay fails. Cancellation, expiry, or relevant
  authorization revocation fences further ArtifactStore/action use and triggers bounded workload and
  egress cleanup. An in-flight assignment is immutable: steering cannot rewrite its action,
  arguments, artifacts, egress, resource ceiling, or capability.

## Alternatives considered

- **Controller-created plain Kubernetes Jobs only** — rejected as the production target because it
  leaves OpenCrane to own another execution protocol, streaming daemon, egress sidecar, TTL, and
  diagnostics stack. A plain-Job adapter may exist only inside the Phase E evaluation harness and
  is deleted when OpenSandbox qualifies. If OpenSandbox fails, production untrusted execution stays
  disabled until another substrate passes the same accepted adapter and security gates.
- **Expose the OpenSandbox SDK or MCP server directly to agents** — rejected because the caller
  could create arbitrary workloads or policy and the shared server credential is not tenant
  authorization.
- **Adopt the complete OpenSandbox platform, including vault and persistence** — rejected because
  it would duplicate Obot credential custody and OpenCrane artifact, policy, and recovery authority.
- **Run tenant code inside the conversational runtime** — rejected because the runtime is not a
  security sandbox and must not gain Python dependencies, mutable durable files, or broad egress.

## Consequences

- Phase D must create `apps/_infra/opensandbox`, the adapter contract, controller-only network path,
  and negative RBAC/network/admission tests before any execution feature uses it.
- Phase E conformance must pin all upstream images and SDKs, stream execution progress into ordered
  RunEvents, test TTL/cancel/delete and node-loss repair, and prove that host/persistent volume,
  lifecycle, policy-mutation, privilege-expansion, credential-copy, and cross-silo paths fail closed.
- OpenSandbox can be upgraded or replaced behind the adapter without changing agent, transcript,
  approval, artifact, or UI contracts.
- Operators gain one additional privileged upstream component to patch and observe. Its scope is
  intentionally smaller than the agent controller and must be audited on every version change.
