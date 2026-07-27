# ADR 0011 — Single run-input and artifact-read authorities

- **Status:** Accepted
- **Date:** 2026-07-26
- **Task:** `#400`–`#402`
- **Clarifies:** the `artifact.read` capability and workload boundary in
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md)
- **Related:** [ADR 0005](0005-opencrane-owned-agent-runtime.md) ·
  [ADR 0010](0010-language-neutral-agent-runtime.md)

## Context

Runtime input compilation and artifact delivery each need one semantic owner. Multiple prompt
compilers or lease issuers would allow policy, immutable revision facts, and delivered bytes to
drift between workloads.

## Decision

- [`libs/backend/agents/execution/inputs/main`](../../libs/backend/agents/execution/inputs/main) is
  the only deterministic input compiler. It assembles an immutable `RunInputSnapshot` through
  injected read ports and hydrates the literal input delivered to the runtime.
- [`libs/backend/artifacts/authorization/main`](../../libs/backend/artifacts/authorization/main)
  owns the storage-neutral read-lease claims, Ed25519 signing and verification, distinct token type,
  and maximum lifetime. A read lease expires no later than 300 seconds after issuance.
- [`libs/backend/server/agents/artifacts/main`](../../libs/backend/server/agents/artifacts/main) is
  the only catalogue-to-lease authority. It reloads the exact active published revision and signs
  only the returned content address, byte length, and media type. It exposes no HTTP route and
  performs no byte I/O.
- [`apps/opencrane`](../../apps/opencrane) owns composition: signing-key access, the application-only
  adapter, the private artifact-service client, and workload-facing byte brokers.
- [`apps/artifact-service`](../../apps/artifact-service) owns the fixed private
  `GET /v1/artifacts/read` endpoint. The signed lease is the sole source of the content address; the
  service preflights the mounted object's exact length and streams only the lease-bound bytes and
  media type.
- Workload-specific admission proves the exact Pod, assignment, bootstrap, and product revision
  before it supplies coordinates to the shared catalogue issuer.
- Untrusted workers receive bytes only through their server broker. They never receive the read
  lease, storage URL, content address, mounted disk, or list/read-by-address capability.

## Alternatives considered

- **Accept a caller-supplied content address beside the lease** — rejected because it creates a
  redundant probing surface.
- **Let each workload domain sign its own catalogue projection** — rejected because immutable
  artifact facts and lease construction need one authority.
- **Replace workload-specific admission with a generic artifact lookup** — rejected because a
  generic lookup cannot prove Pod identity, assignment, or bootstrap state.
- **Compile prompts near the runtime protocol** — rejected because delivery would become a second
  semantic authority.

## Consequences

- A new artifact consumer first proves domain-specific admission and then calls the shared catalogue
  issuer.
- Artifact-service may change storage adapters if exact byte-length preflight and immutable-address
  reads remain intact.
- Tests preserve the fixed endpoint, separate read header, five-minute maximum, active and published
  catalogue filters, byte-length preflight, and absence of worker-visible leases.
