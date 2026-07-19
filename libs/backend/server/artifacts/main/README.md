# @opencrane/backend/server/artifacts — artifact finalization write authority

Owns the finalization of artifact revisions: turning bytes already promoted by the ArtifactStore
into canonical revision metadata, the current-revision pointer, a consumed promotion receipt, and
an outbox event — all in one atomic repository commit. `__FinalizeArtifactRevision` validates the
storage-neutral command first (SHA-256 content address, non-negative byte length, media type,
lease id, receipt digest, positive revision, creator, idempotency key) and denies anything
malformed before persistence. Replayed idempotency keys surface as `finalized` with
`idempotent: true`; stale or replayed promotion receipts stay fail-closed.

The boundary is deliberate: this authority persists leases, receipts, and metadata — it never
stores or serves artifact bytes, which remain behind the ArtifactStore. Persistence goes through
the `ArtifactAuthorityRepository` port whose atomic contract is exercised directly against
Postgres by `tests/artifact-authority.sql` (the `test:sql` target). The OpenCrane server composes
it; the library exposes no transport.

Tagged `scope:artifacts`: it may depend only on `scope:artifacts` (the models package) and
`scope:shared` — never on apps, byte stores, or sibling domains.
