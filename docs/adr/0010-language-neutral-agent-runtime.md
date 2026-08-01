# ADR 0010 — Language-neutral agent runtime

- **Status:** Accepted
- **Date:** 2026-07-21
- **Task:** `#246`
- **Supersedes:** the runtime-language clause in
  [ADR 0005](0005-opencrane-owned-agent-runtime.md)
- **Related:** [ADR 0008](0008-target-agent-contracts-and-workload-identity.md) ·
  [platform architecture](../design/personal-agent-platform-architecture.md)

## Context

The runtime is a separately deployed workload behind `AgentRuntimeProtocol v1`. It opens an
authenticated outbound command stream and receives fenced `start_attempt`, `resume_attempt`, and
`cancel_attempt` commands. It holds no durable authority, Kubernetes RBAC, database access, or
provider master secret, so its implementation language is not a product contract.

## Decision

- The runtime protocol is language-neutral. The control plane remains TypeScript, while an
  implementation behind the protocol may use another language.
- The current [`apps/agent-runtime`](../../apps/agent-runtime) implementation uses
  `pydantic-ai-slim[openai]==2.13.0` for its bounded Python model/tool loop.
- Deterministic input compilation remains in
  [`libs/backend/agents/execution/inputs/main`](../../libs/backend/agents/execution/inputs/main).
  The runtime consumes opaque compiled input.
- OpenCrane retains retry, fallback, aggregate budgets, cancellation, steering, approval, external
  action, and terminal authority.
- Framework types, identifiers, checkpoints, and retry behaviour remain inside the adapter.
  Implicit model, tool, and output retries are configured to zero.
- The runtime reaches the per-silo LiteLLM proxy only through an attempt-scoped credential.

Live model-proxy exercises validate the pinned implementation. They do not alter the authority
boundary or create a second supported runtime path.

## Alternatives considered

- **Make TypeScript the protocol contract** — rejected because language adds no authority or
  interoperability guarantee.
- **Make Python framework types durable contracts** — rejected because it would couple recovery and
  storage to one library.
- **Let the runtime compile persona, tools, model, and budget input** — rejected because compilation
  would become a second policy authority.

## Consequences

- The runtime can be reimplemented without changing public or durable contracts.
- Protocol conformance, security, failure, and model-proxy tests qualify the implementation.
- Package pins and supported model behaviour remain visible in the runtime image and test suite.
