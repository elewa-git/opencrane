# ADR 0011 — Single run-input and artifact-read authorities

- **Status:** Accepted 2026-07-26
- **Date:** 2026-07-26
- **Task:** Phase D/E lane reconciliation (`#400`–`#402`)
- **Supersedes / superseded by:** clarifies the `artifact.read` capability and workload boundary in
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md); no ADR is superseded
- **Related:** [ADR 0005](0005-opencrane-owned-agent-runtime.md) ·
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md) ·
  [ADR 0010](0010-language-neutral-agent-runtime.md)

## Context

Phase D and Phase E were implemented through several dependent branches. Their later branches built
working runtime input compilation and skill-authoring artifact delivery, while an earlier artifact
lane separately introduced a generic catalogue-to-lease issuer and an addressless ArtifactStore read
contract. Replaying every branch would create parallel prompt compilers, multiple places that turn
catalogue facts into leases, and two private byte-read protocols.

The product is a clean build. There is no compatibility reason to preserve both shapes. The
reconciliation therefore needs one owner for each decision and a narrow composition path from
workload admission to immutable bytes.

## Decision

- Deterministic input compilation has one implementation under
  `libs/backend/agents/execution/inputs/main`. It hydrates an immutable `RunInputSnapshot` through
  injected read ports. Runtime workloads consume compiled input and never reimplement prompt,
  persona, memory, tool, model, or budget assembly.
- `libs/backend/artifacts/authorization/main` owns the storage-neutral read-lease claim, Ed25519
  signing and verification rules, distinct token type and verification contract, and the hard
  lifetime limit. Read and write leases share the private artifact-service audience but cannot be
  substituted because each verifier requires its exact token type and claims.
  A read lease expires no later than 300 seconds after issuance.
- `libs/backend/server/agents/artifacts/main` is the only catalogue-to-lease authority. Given
  already-authorized silo, artifact, and revision coordinates, it reloads an active artifact's
  exact published revision and signs only the returned content address, byte length, and media type.
  It exposes no HTTP route and performs no byte I/O.
- `apps/opencrane` owns composition: mounted private-key access, the app-only signing adapter, the
  private artifact-service client, and the worker-facing byte broker. A workload-specific repository
  remains responsible for proving the exact Pod, assignment, bootstrap, and product revision before
  it supplies coordinates to the generic artifact issuer.
- `apps/artifact-service` owns the fixed private `GET /v1/artifacts/read` endpoint. The signed lease
  is the sole source of the content address. The service preflights the mounted object's exact length
  before sending a successful response and streams only the lease-bound bytes and media type.
- Untrusted workers receive bytes only through their server broker. They never receive the read
  lease, ArtifactStore URL, content address, mounted disk, or a list/read-by-address capability.

## Alternatives considered

- **Keep the later read-by-address route because it compares the URL digest with the lease.**
  Rejected. The address is redundant input, creates a second probing surface, and weakens the rule
  that the signed lease is the only read request.
- **Let each workload domain sign its own catalogue projection.** Rejected. Workload admission is
  intentionally domain-specific, but immutable artifact facts and lease construction need one
  catalogue authority so every consumer receives the same active/published/silo checks.
- **Replace the workload-specific selector with the generic artifact lookup.** Rejected. The generic
  lookup cannot prove Pod identity, bootstrap consumption, assignment state, or the product record
  that authorized the artifact. Both checks are required in sequence and own different decisions.
- **Replay a second prompt compiler near the runtime protocol.** Rejected. It would make delivery a
  second semantic authority and allow compilation to drift from run admission.

## Consequences

- A new artifact consumer must first prove its domain-specific admission, then call the shared
  catalogue issuer; it cannot mint a lease from caller-supplied byte metadata.
- Artifact-service can change its storage adapter without changing product or workload authorities,
  provided the adapter preserves exact byte-length preflight and immutable-address reads.
- The read lease is deliberately reusable only within its short expiry. One-time admission stays in
  the workload bootstrap/exchange authority; the lease is a service credential and never crosses
  into the workload.
- Tests must keep the fixed endpoint, separate read header, five-minute maximum, active/published
  catalogue filters, byte-length preflight, and absence of worker-visible leases intact.
