# @opencrane/backend/artifacts/store — artifact promotion protocol & validation guards

> [backend](../../../README.md) › [artifacts](../../README.md) › store

## What it owns

An **artifact** is a stored file or output named by the hash of its bytes (CAS, content-addressed
storage). Storing one has two phases: **staging** (write the incoming bytes to a private temporary
place while hashing them) and **promotion** (publish those bytes under their permanent content
address). This package owns the **protocol** that drives both phases safely, plus the validation
guards every step relies on. It defines *what* a store must do; it does not touch the disk itself.

```
 bounded upload  (compact lease · declared length · byte stream)
          │  __PromoteArtifactUpload
          ▼
 ┌────────────────────────────────────────┐
 │   store  ◄── HERE                        │  verify lease → stage → promote → sign receipt
 │   (ArtifactStore interface + guards)     │  bounded by lease expiry AND a hard deadline
 └────────────────────────────────────────┘
          │  stage()/promote() calls
          ▼
 filesystem adapter  ── hashes, fsyncs, and atomically links the canonical object
```

**In this flow:** [authorization](../../authorization/main/README.md) *(verifies the lease, signs the receipt)* ·
[filesystem](../../filesystem/main/README.md) *(the on-disk `ArtifactStore` this protocol drives)*

`__PromoteArtifactUpload` is the orchestrator: it verifies the caller's lease (a short-lived signed write permit) *before* reading any
untrusted bytes, rejects a declared body larger than the lease allows, and bounds the whole
stage-then-promote sequence by both a process deadline and the lease's own expiry — cancelling the
byte source if either passes, so a slow or oversized upload cannot hold resources open. Only a
completed canonical promotion produces a signed receipt (the signed proof the bytes were stored).

The `__Validate*` guards are the store's fail-closed gatekeepers: they check that a lease, a stage
command, a staged handle, and a promotion result each carry a well-formed content address (strict
`sha256:` + 64 hex), a safe non-negative byte length, and a real media type before anything durable
happens. Invariant: bytes are only ever named by their true hash, size and lease are enforced at every
boundary, and a receipt is impossible unless the exact authorised object became canonical in time.

## Public surface

- `__PromoteArtifactUpload(store, leaseVerifier, byteSource, config)` — the end-to-end promotion protocol (verify → stage → promote → receipt).
- `__ValidateVerifiedArtifactWriteLease`, `__ValidateStageArtifactCommand`, `__ValidateStagedArtifact`, `__ValidateArtifactStorePromotion` — the fail-closed input guards.
- `ArtifactStore` — the storage port an adapter implements (`stage` · `promote` · `byteLength` · `read` · `purge`). `byteLength` lets a read boundary reject a mismatched object before it commits response headers or bytes.
- `ArtifactPromotionLeaseVerifier` / `ArtifactPromotionReceiptSigner` — the injected signing/verification seams.
- `StageArtifactCommand`, `StagedArtifact`, `ArtifactStorePromotion`, `PromoteArtifactUploadResult`, `BoundedArtifactUploadByteSource`, and the related claim/config types.

## Boundary

The transport-neutral core of `artifact-service`: an HTTP adapter feeds it a `BoundedArtifactUploadByteSource`,
and a filesystem adapter provides the `ArtifactStore`. It authenticates nothing itself — it delegates
lease verification and receipt signing to injected seams (implemented by
[authorization](../../authorization/main/README.md)) — and it never persists catalog state.

## Dependency direction

Tagged `scope:artifacts`: it may depend only on `scope:artifacts` and `scope:shared` — never on apps
or sibling domains.

## See also

- Parent index: [artifacts](../../README.md)
- Siblings: [authorization](../../authorization/main/README.md) · [filesystem](../../filesystem/main/README.md)
