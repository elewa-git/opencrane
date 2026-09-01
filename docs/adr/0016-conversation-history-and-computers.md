# ADR 0016 — Conversation history and computers

- **Status:** Accepted
- **Date:** 2026-08-31
- **Task:** [#759](https://github.com/elewa-git/opencrane/issues/759)
- **Supersedes:** the run-owned, disposable-compute clauses in ADRs 0005, 0008, 0010, and 0014; the
  relational transcript authority in ADR 0012; and the PostgreSQL-only protected-fact persistence
  clause in ADR 0015.

## Context

An agent conversation needs a durable identity and workspace even when its compute is cold. The
current design makes a run, PostgreSQL message rows, and a one-use claimed Pod jointly describe the
product. That couples participant history to a mutable read model and makes the computer model false
at the boundary where it matters most.

The 0.11.0 train is a fresh-install baseline. There is no source-silo upgrade, backfill, dual write,
or relational fallback. A failed replacement is recovered by installing the previous reviewed
baseline, not by accepting new writes through two authorities.

## Decision

Every conversation owns `conversation-{id}` in KurrentDB from creation. It is the ordered,
participant-visible history for messages, safe logs, A2UI, membership conditions, and receipt
transformations. PostgreSQL keeps rebuildable directory, participant, access-bound, unread, and
query projections only. Message bodies are private-payload references and ciphertext digests in the
stream; irreversible plaintext and credentials never enter an immutable event.

Each agent conversation owns one logical `ConversationComputer` and a resolved agent identity. A
computer can have zero or one fenced live lease. OpenCrane records and authorizes the claim; the
Kubernetes SIG Agent Sandbox controller reconciles `SandboxClaim`, `SandboxTemplate`, and
`SandboxWarmPool`. OpenCrane does not introduce another Pod lifecycle controller. A restored
computer uses the admitted profile, stream history, and verified ArtifactStore workspace checkpoint.

Run admission resolves a current active computer lease before it seals an immutable execution
subject and input snapshot. A cold computer first reaches the durable activation queue and becomes
warm through its checked claim/lease history; the admission transaction then rechecks the exact
computer generation, lease, identity head, membership, and capability decision. A snapshot never
contains an optional future lease, and a later runtime assignment cannot manufacture or replace its
execution subject.

KurrentDB owns history only. PostgreSQL remains canonical for memberships, grants, deny rules, and
the transaction-bound `AuthorizationAuthority`. A protected call rechecks current PostgreSQL
authority and commits its decision evidence with the protected fact; its Kurrent event carries the
evidence digest. A complete PostgreSQL outbox-to-Kurrent permission-audit stream may support audit
and disaster recovery, but can never authorize a request.

The server depends on a narrow Kurrent-only `HistoryStore` port with `readStream`, `readHead`,
`append`, `appendAtomic`, and `subscribe`. Its adapter uses the official
`@kurrent/kurrentdb-client` 1.3.x gRPC client. The admission test must prove the actual client and
topology support every exposed operation. No PostgreSQL event-store implementation is permitted.
Conversation-local membership and posting contend on the same stream head; stale writers reload and
are denied. Cross-stream authorization transactions are deliberately not inferred from the port.

The initial deployment is silo-local KurrentDB with persistent storage, TLS, authenticated
least-privilege credentials, default-deny network policy, telemetry, and a tested backup/restore
path. The Kubernetes Agent Sandbox controller and CRDs are cluster prerequisites. `testv5` may be
created only after both prerequisites, an approved RuntimeClass, immutable images, and the fresh
install are qualified.

## Alternatives considered

- **Keep PostgreSQL as a temporary event store** — rejected. It would preserve a second canonical
  message authority and make the later cutover a compatibility project.
- **Put permissions in KurrentDB** — rejected. Current revocation and protected writes need the
  existing serializable PostgreSQL authority; an audit stream is not a policy engine.
- **Build another warm-Pod controller** — rejected. Agent Sandbox already owns the Kubernetes
  realization lifecycle and exposes the claim/warm-pool primitives this product needs.
- **Install an insecure single-node event store for testv5** — rejected. A successful unsafe smoke
  would not qualify the TLS, credentials, retention, restore, or isolation contract.

## Consequences

- The 0.11.0 conversation replacement deletes the relational message, run-event, timeline writer,
  replay fallback, and browser SSE translation together; no production mode is partially flipped.
- A bound writer may append only validated agent-authored entries to its exact conversation stream.
  It receives no global read, Kurrent administration, cross-conversation writer, IAM writer, or
  effect-success authority.
- The admission gate must explicitly record KurrentDB and Agent Sandbox versions, licences, CRDs,
  image digests, storage class, RuntimeClass, network paths, benchmarks, and restore evidence.
- Missing KurrentDB or Agent Sandbox prerequisites blocks a testv5 deployment rather than causing a
  fallback to the 0.10 runtime model.
