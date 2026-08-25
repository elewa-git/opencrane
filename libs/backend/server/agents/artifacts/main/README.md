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

Published PDFs create a preprocessing job and save a **workflow task** in the same database
transaction. The task records conversion work for the controller handler that will be added later.
Saving both records together means a published PDF never exists without its matching conversion
task. The current worker receives only a fenced attempt and the source length. OpenCrane brokers
the PDF to it, accepts the bounded text response, and keeps every storage lease and promotion
receipt inside the trusted server process:

```
 published PDF ──► durable fenced job ──► broker PDF bytes ──► isolated converter
        ▲                                                     │
        └── derived text revision + immutable lineage ◄── broker text bytes
```

Conversation uploads instead enter a quarantined revision. The dedicated scanner receives only a
fenced attempt and brokered bytes. A clean verdict publishes the exact revision; a rejection or
terminal scanner failure leaves it unavailable and gives the participant only a stable failure.

**In this flow:** [skills](../../skills/main/README.md) · [agent-services](../../agent-services/main/README.md) *(both pin artifacts)*

Invariant: this domain never touches artifact bytes — no upload, no download, no hashing of content
here. It commits revision metadata, the current-revision pointer, the lease consumption, and the
outbox event in one transaction, keyed by an idempotency key so a retried finalize returns the same
result instead of creating a duplicate. A stale, replayed, or already-consumed receipt fails closed.
Read leases contain only facts reloaded from the catalogue; caller-provided digests, byte counts,
media types, storage paths, and URLs never become read authority.

Preprocessing uses the same rule. The database owns claim expiry, retry ceilings, output identity,
and source lineage. A typed read-only Prisma view performs the database-owned `SKIP LOCKED`
selection, and a second view supplies the database clock used by serializable delegate updates.
Source issuance revalidates the exact fenced job and caps signed authority to the earlier of the
claim deadline or the 30-second retry quiet period. An expired or early-failed attempt therefore
cannot overlap a reclaimed one. Incomplete generated artifacts have no current revision and remain
absent from the user catalogue. The isolated worker never receives a content address, ArtifactStore
endpoint, signed lease, or promotion receipt.

Only an in-flight preprocessing job holds its source and output metadata in place. A completed or
terminally failed job remains immutable audit evidence, but it does not indefinitely prevent an
authorised artifact-deletion lifecycle once no active job needs those rows.

## Public surface

- `__FinalizeArtifactRevision` — commit promoted bytes into a visible, immutable revision.
- `__IssueArtifactReadLease` — reload an active artifact's exact published revision and issue one
  internal read lease that expires after at most five minutes.
- `__UploadArtifact` — orchestrate the full verified upload (lease → promote → finalize).
- `_CreateArtifactUploadAuthority` — app-only composition for the two short publication
  transactions on either side of byte-store promotion.
- `_CreateArtifactPreprocessAuthority` and `__CreateArtifactPreprocessorRouter` — durable job
  fencing and the TokenReview-protected broker-only worker protocol. Each lifecycle transition has
  its own private transaction; no transaction crosses TokenReview, byte brokering, or promotion.
- `PrismaArtifactScanUnitOfWork` and `__CreateArtifactScannerRouter` — quarantine publication,
  bounded retries, and the TokenReview-protected scanner protocol. App composition supplies a
  conversation-lifecycle repository factory; the unit of work binds it and the scan repository to
  the same transaction without making the artifact package an owner of conversation rows.
- `_CreateArtifactCatalogueRepository` — read-only active/published catalogue facts for internal
  lease issuance; it never acquires publication or preprocessing locks.
- `ArtifactPreprocessSourceLeaseIssuer` — the narrow durable port that lets app composition issue
  source-read facts without depending on the Prisma adapter.
- `__ClaimArtifactPreprocessJob`, `__IssueArtifactPreprocessOutputLease`,
  `__CompleteArtifactPreprocessJob`, and `__FailArtifactPreprocessJob` — server-owned preprocessing
  lifecycle operations; output leases remain internal projections rather than worker DTOs.
- `__AdmitArtifactPreprocessWorkflow` and `__ArtifactPreprocessWorkflowTaskKey` — save the declared
  PDF conversion task through the caller's existing database transaction. The key is based on the
  silo and published source revision, so a retried transaction requests the same task.
- `__CreatePersonalArtifactCatalogueRouter` — serves `GET /api/v1/me/assets`, a bounded list of
  non-deleted asset metadata owned by the signed-in caller in the trusted host silo.
- `_CreatePersonalArtifactCatalogueRouter` — the ready-to-mount Prisma composition that maps the
  shared request principal to catalogue ownership and supplies the authority repository.
- Types: `ArtifactAuthorityRepository`, `ArtifactStorePromotionReceipt`, `FinalizeArtifactRevisionCommand`,
  the read-lease ports (`ArtifactReadLeaseRepository`, `ArtifactReadLeaseSigner`,
  `IssueArtifactReadLeaseCommand`) plus the stable `IssueArtifactReadLeaseOutcomes` result vocabulary,
  and the upload ports (`ArtifactServicePromotionPort`,
  `ArtifactUploadCryptoPort`, `ArtifactUploadLeaseRepository`, `VerifiedArtifactUploadCommand`,
  `ArtifactUploadResult`).

## Boundary

The application layer wires the byte-store client, the crypto port, and named authority-composition
factories into the use cases. Proof verification and replay reservation happen upstream — this package trusts that a
`VerifiedArtifactUploadCommand` is already authorized, and its job is to keep metadata consistent
with what the byte store actually promoted.

The upload authority deliberately has two transactions: the first reserves the exact single-use
lease, then the app calls the byte store with no database transaction open, and the second consumes
the verified receipt, publishes the revision, saves any PDF workflow task, and writes the outbox
event. Preprocessing follows the same rule one fenced transition at a time. This avoids long-held
locks around network work while retaining the established lock order, receipt idempotency, and
outbox ordering.

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

The scanner router follows the same internal-only rule in its own restricted namespace and with a
different fixed audience. It allocates read facts only under a live scan fence, keeps the signed
lease inside the server, and accepts no result or failure after database-owned claim expiry.

## Dependency direction

Tagged `scope:artifacts`: it may depend only on `scope:artifacts` (the byte store, filesystem, and
authorization siblings under `libs/backend/artifacts/`), `scope:auth` (only for request-principal
resolution), and `scope:shared` — never on apps or other server domains.

## Data & persistence

Owns `Artifact`, `ArtifactRevision`, `ArtifactRevisionParent`, `ArtifactUploadLease`,
`ArtifactPreprocessJob`, `ArtifactScanJob`, and `ArtifactOutboxEvent` in
`apps/opencrane/prisma/schema/artifacts.prisma`. A companion SQL authority test in
`tests/artifact-authority.sql` proves job fencing, exact output binding, lease finalization, and
immutable source lineage. Production TypeScript uses only typed Prisma delegates; PostgreSQL-specific
clock and nonblocking claim semantics remain in the reviewed clean target baseline.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [agent-services](../../agent-services/main/README.md) · [channel-targets](../../channel-targets/main/README.md)
- Worker libraries: [artifact preprocessor](../../../../artifacts/preprocessor/main/README.md) · [artifact scanner](../../../../artifacts/scanner/main/README.md)
