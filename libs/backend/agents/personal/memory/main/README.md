# @opencrane/backend/agents/personal/memory — memory fact catalogue authority

Personal-agent product domain that catalogues durable memory facts. `__RecordMemoryFact`
records metadata and provenance only — dataset, Cognee external id, a SHA-256 content digest
(validated with `___IsSha256ContentAddress`), consent state, sensitivity, and exactly one
explainable source (an `ArtifactRevision`, a `Message`, or an explicit user statement). The
durable fact content itself stays in Cognee and is never copied into Postgres.

Persistence sits behind `MemoryCatalogRepository.recordFactAtomically`, which commits the
catalogue row and the downstream Cognee outbox intent in one transaction; repeat delivery of
the same `idempotencyKey` is reported as success (`idempotent: true`), while retired or
missing datasets and correction conflicts fail closed. Corrections reference the superseded
fact via `supersedesFactId` rather than mutating it. Database-side guarantees are exercised
by `tests/memory-authority.sql` via the `test:sql` target.

It does not talk to Cognee, run retrieval, or store fact content — it is the catalogue write
authority composed by the personal-agent product backend.

Tagged `type:lib`, `layer:backend`, `scope:personal-memory`: it may depend only on
`scope:artifacts` models and `scope:shared` packages — never on apps or sibling
personal-agent domains.

See [`../../README.md`](../../README.md) for the personal-agent capability map.
