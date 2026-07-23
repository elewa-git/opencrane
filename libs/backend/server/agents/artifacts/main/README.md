# @opencrane/backend/server/agents/artifacts — finalize artifact metadata

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › artifacts

## What it owns

An *artifact* is any file an agent produces or consumes — a skill bundle, a document, a build
output. OpenCrane splits an artifact into two halves: the **bytes** (stored once, addressed by a
SHA-256 content address, which is a fingerprint computed from the bytes themselves) and the
**metadata** (the visible record: which artifact, which revision, who made it, where it came from).
The bytes live behind a separate byte store; this package is the authority for the metadata.

It runs the final step of the upload flow. A caller with a proof-authorized upload asks for a
short-lived write lease; the artifact-service promotes the staged bytes and returns a signed
promotion receipt; this package then records the revision, only after confirming the receipt is
genuine and has not already been used.

```
 verified upload request   (content address · byte length · media type)
        │ 1. issue a single-use write lease
        ▼
 artifact-service promotes the staged bytes  ──►  signed promotion receipt
        │
        ▼
 ┌──────────────────────────────────────┐
 │  artifacts  ◄── HERE                  │  receipt genuine + not yet consumed? commit metadata
 └──────────────────────────────────────┘
        │  finalized ArtifactRevision  (+ an outbox event, + the current-revision pointer)
        ▼
 skills / agent revisions reference the exact ArtifactRevision by content address
```

When that immutable source is a PDF, the same transaction also records exactly one
`pdf-to-text/v1` preprocessing job and an `artifact.preprocessing_requested` outbox event. It does
not run a converter in the server or store extracted text in a JSON column. A subsequent fenced
worker claim allocates one generated text Artifact; once the worker knows the exact text hash, this
authority binds that attempt to one exact write lease. It accepts completion only after the attached
lease is finalized for those exact bytes, preserves immutable source lineage, and publishes normal
revision evidence for downstream indexing.

**In this flow:** [skills](../../skills/main/README.md) · [agent-services](../../agent-services/main/README.md) *(both pin artifacts)*

Invariant: this domain never touches artifact bytes — no upload, no download, no hashing of content
here. It commits revision metadata, the current-revision pointer, the lease consumption, and the
outbox event in one transaction, keyed by an idempotency key so a retried finalize returns the same
result instead of creating a duplicate. A stale, replayed, or already-consumed receipt fails closed.

## Public surface

- `__IssueArtifactReadLease` — re-checks one active artifact's exact published revision before issuing a five-minute internal read lease; it exposes no HTTP route or storage path.

- `__FinalizeArtifactRevision` — commit promoted bytes into a visible, immutable revision.
- `__UploadArtifact` — orchestrate the full verified upload (lease → promote → finalize).
- `PrismaArtifactAuthorityRepository` — the Postgres-backed persistence adapter.
- Types: `ArtifactAuthorityRepository`, `ArtifactStorePromotionReceipt`, `FinalizeArtifactRevisionCommand`,
  and the upload ports (`ArtifactServicePromotionPort`, `ArtifactUploadCryptoPort`,
  `ArtifactUploadLeaseRepository`, `VerifiedArtifactUploadCommand`, `ArtifactUploadResult`).
- The preprocessing state model: one source/pipeline job, an attempt/fence/expiry, a server-chosen
  generated Artifact, and one durable `outputLeaseId`. That one-to-one lease reference prevents a
  receipt from a previous attempt or an unrelated upload from being attached to a PDF result.

## Boundary

The application layer wires the byte-store client, the crypto port, and the Prisma adapter into the
use cases. Proof verification and replay reservation happen upstream — this package trusts that a
`VerifiedArtifactUploadCommand` is already authorized, and its job is to keep metadata consistent
with what the byte store actually promoted.

## Dependency direction

Tagged `scope:artifacts`: it may depend only on `scope:artifacts` (the byte store, filesystem, and
authorization siblings under `libs/backend/artifacts/`) and `scope:shared` — never on apps or other
server domains.

## Data & persistence

Owns `Artifact`, `ArtifactRevision`, `ArtifactRevisionParent`, `ArtifactUploadLease`,
`ArtifactPreprocessJob`, and `ArtifactOutboxEvent` in
`apps/opencrane/prisma/schema/artifacts.prisma`. A companion SQL authority test lives in
`tests/artifact-authority.sql`. Preprocess jobs are distinct from the outbox: a job has its own
attempt, claim fence, expiry, output coordinate, and retry/terminal state, while an outbox event only
records publication for independent downstream consumers. While a worker is writing, its durable
output lease must be active, exact-byte-bound, and no later than the claim expiry. Completion changes
that same lease to finalized and proves its promoted address and length equal the immutable derived
revision; failed attempts drop the job reference instead of retaining a reusable capability.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [agent-services](../../agent-services/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
