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

For internal reads, an upstream authority first decides *which* revision a workload may use. This
package then reloads that exact revision through the active artifact and published-revision
relations before minting a short-lived lease from catalogue-owned facts:

```
 workload-specific admission  ──►  silo + artifact + revision coordinates
                                          │
                                          ▼
                        reload active published catalogue facts
                                          │ exact digest · bytes · media type
                                          ▼
                         five-minute-maximum signed read lease
```

Published PDFs also create one durable preprocessing job in the same transaction. A dedicated
worker receives only a fenced attempt and the source length. OpenCrane brokers the PDF to it,
accepts the bounded text response, and keeps every storage lease and promotion receipt inside the
trusted server process:

```
 published PDF ──► durable fenced job ──► broker PDF bytes ──► isolated converter
        ▲                                                     │
        └── derived text revision + immutable lineage ◄── broker text bytes
```

**In this flow:** [skills](../../skills/main/README.md) · [agent-services](../../agent-services/main/README.md) *(both pin artifacts)*

Invariant: this domain never touches artifact bytes — no upload, no download, no hashing of content
here. It commits revision metadata, the current-revision pointer, the lease consumption, and the
outbox event in one transaction, keyed by an idempotency key so a retried finalize returns the same
result instead of creating a duplicate. A stale, replayed, or already-consumed receipt fails closed.
Read leases contain only facts reloaded from the catalogue; caller-provided digests, byte counts,
media types, storage paths, and URLs never become read authority.

Preprocessing uses the same rule. The database owns claim expiry, retry ceilings, output identity,
and source lineage. Source issuance locks the job against failure and reclaim, then caps signed
authority to the earlier of the claim deadline or the 30-second retry quiet period. An expired or
early-failed attempt therefore cannot overlap a reclaimed one. Incomplete generated artifacts have
no current revision and remain absent from the user catalogue. The isolated worker never receives a
content address, ArtifactStore endpoint, signed lease, or promotion receipt.

Only an in-flight preprocessing job holds its source and output metadata in place. A completed or
terminally failed job remains immutable audit evidence, but it does not indefinitely prevent an
authorised artifact-deletion lifecycle once no active job needs those rows.

## Public surface

- `__FinalizeArtifactRevision` — commit promoted bytes into a visible, immutable revision.
- `__IssueArtifactReadLease` — reload an active artifact's exact published revision and issue one
  internal read lease that expires after at most five minutes.
- `__UploadArtifact` — orchestrate the full verified upload (lease → promote → finalize).
- `PrismaArtifactAuthorityRepository` — the Postgres-backed persistence adapter.
- `PrismaArtifactPreprocessRepository` and `__CreateArtifactPreprocessorRouter` — durable job
  fencing and the TokenReview-protected broker-only worker protocol.
- `__ClaimArtifactPreprocessJob`, `__IssueArtifactPreprocessOutputLease`,
  `__CompleteArtifactPreprocessJob`, and `__FailArtifactPreprocessJob` — server-owned preprocessing
  lifecycle operations; output leases remain internal projections rather than worker DTOs.
- `__CreatePersonalArtifactCatalogueRouter` — serves `GET /api/v1/me/assets`, a bounded list of
  non-deleted asset metadata owned by the signed-in caller in the trusted host silo.
- `_CreatePersonalArtifactCatalogueRouter` — the ready-to-mount Prisma composition that maps the
  shared request principal to catalogue ownership and supplies the authority repository.
- Types: `ArtifactAuthorityRepository`, `ArtifactStorePromotionReceipt`, `FinalizeArtifactRevisionCommand`,
  the read-lease ports (`ArtifactReadLeaseRepository`, `ArtifactReadLeaseSigner`,
  `IssueArtifactReadLeaseCommand`), and the upload ports (`ArtifactServicePromotionPort`,
  `ArtifactUploadCryptoPort`, `ArtifactUploadLeaseRepository`, `VerifiedArtifactUploadCommand`,
  `ArtifactUploadResult`).

## Boundary

The application layer wires the byte-store client, the crypto port, and the Prisma adapter into the
use cases. Proof verification and replay reservation happen upstream — this package trusts that a
`VerifiedArtifactUploadCommand` is already authorized, and its job is to keep metadata consistent
with what the byte store actually promoted.

Read-lease issuance is internal and has no router. It does not decide which workload may name an
artifact; the caller must already have passed its workload-specific admission authority. The issuer
then independently reloads the exact active/published catalogue facts and delegates signing to an
app-owned port backed by mounted key material. The lease and ArtifactStore endpoint never reach the
workload.

The personal catalogue is discovery only. It returns kind, lifecycle, current-revision media type,
size, indexing state, and timestamps. It never returns bytes, a content address, provenance,
leases, promotion receipts, or outbox records, and it cannot upload, download, mutate, or delete an
asset.

The preprocessor router is mounted only on the internal listener when the worker is enabled.
NetworkPolicy admits the exact dedicated namespace, and TokenReview binds the fixed ServiceAccount
and audience. App composition alone may exchange brokered bytes with artifact-service.

## Dependency direction

Tagged `scope:artifacts`: it may depend only on `scope:artifacts` (the byte store, filesystem, and
authorization siblings under `libs/backend/artifacts/`), `scope:auth` (only for request-principal
resolution), and `scope:shared` — never on apps or other server domains.

## Data & persistence

Owns `Artifact`, `ArtifactRevision`, `ArtifactRevisionParent`, `ArtifactUploadLease`,
`ArtifactPreprocessJob`, and `ArtifactOutboxEvent` in
`apps/opencrane/prisma/schema/artifacts.prisma`. A companion SQL authority test in
`src/__tests__/artifact-authority.sql` proves job fencing, exact output binding, lease finalization, and
immutable source lineage.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [agent-services](../../agent-services/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
- Worker library: [artifact preprocessor](../../../../artifacts/preprocessor/main/README.md)
