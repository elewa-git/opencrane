# ADR 0005 — OpenCrane-owned agent runtime

- **Status:** Accepted; runtime-language clause superseded by
  [ADR 0010](0010-language-neutral-agent-runtime.md)
- **Date:** 2026-07-16
- **Task:** `#245`
- **Related:** [platform architecture](../design/personal-agent-platform-architecture.md) ·
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md)

## Context

OpenCrane governs identity, authorization, run input, ordered events, approvals, budgets, artifacts,
memory, scheduling, cancellation, retry, and audit. Allowing a model-loop framework or runtime
workload to own parallel sessions, transcripts, tool policy, or recovery state would create two
authorities for the same run.

## Decision

OpenCrane owns the personal and managed-agent runtime end to end.

- The control plane owns canonical `Thread`, `AgentRun`, immutable `RunInputSnapshot`, ordered
  `RunEvent`, approval, retry, cancellation, budget, and terminal state.
- The runtime workload owns only the bounded model/tool loop behind the
  `AgentRuntimeProtocol v1` boundary.
- Framework classes, messages, identifiers, events, and checkpoints do not cross into public or
  durable OpenCrane contracts.
- External actions are candidates until the control plane authorizes, executes, and persists them.
- The runtime has no direct Postgres access, Kubernetes RBAC, provider master secret, or authority to
  append canonical events.
- Recovery reconstructs an attempt from canonical state rather than workload-local files.

ADR 0010 replaces the original language-specific implementation clause. Runtime ownership remains
unchanged.

## Alternatives considered

- **Let the loop framework own the transcript and session** — rejected because recovery and audit
  would depend on framework-specific state.
- **Run a shared worker with direct database and provider access** — rejected because it combines
  orchestration, credential, and execution authorities.
- **Allow the runtime to execute tools directly** — rejected because grants, approvals,
  idempotency, and durable evidence must be enforced server-side.

## Consequences

- OpenCrane assumes responsibility for reconnect, cancellation, approval resume, ordering, retry,
  compaction, and terminal-state correctness.
- Runtime implementations remain replaceable behind a language-neutral protocol.
- Tests must prove the workload cannot become a second durable or authorization authority.
