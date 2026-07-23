# @opencrane/backend/artifacts/authorization — artifact lease & receipt authority

> [backend](../../../README.md) › [artifacts](../../README.md) › authorization

## What it owns

An **artifact** is a stored file or output — a document, an image, a tool result — addressed by the
hash of its bytes (CAS, content-addressed storage: the file's name *is* the fingerprint of its
content). Writing one is a two-party dance between OpenCrane and a separate upload service
(`artifact-service`), and neither side trusts the other's raw claims. This package owns the two signed
tokens that make that trust concrete.

A **write lease** is a short-lived signed permission slip: "this silo (one tenant's isolated running environment) may write this artifact, up to
this size, matching this hash, until this moment." A **read lease** is equally narrow: "this one
run or worker operation may read exactly this canonical address until this moment." A **promotion
receipt** is the signed proof that comes back: "the bytes with this hash and length were stored."
All are compact signed tokens (JWS using EdDSA, a standard signature scheme) that only OpenCrane's
keys can produce and verify.

```
 OpenCrane catalog wants to store an artifact
          │  __SignArtifactWriteLease
          ▼
 ┌──────────────────────────────┐
 │   authorization  ◄── HERE     │  sign lease  →  ... upload happens ...  →  verify receipt
 └──────────────────────────────┘
          │  write lease ──► artifact-service verifies it, then stages & promotes bytes
          │  read lease ───► artifact-service streams only that exact CAS address
          │  receipt ◄── artifact-service signs the stored facts
          ▼
 catalog finalises the artifact only after __VerifyArtifactPromotionReceipt
```

**In this flow:** [store](../../store/main/README.md) *(runs the promotion protocol that consumes the lease and emits the receipt)* ·
[filesystem](../../filesystem/main/README.md) *(the on-disk store the bytes land in)*

The two tokens use **separate keys and audiences** on purpose: a lease is addressed to
`artifact-service` and a receipt back to `opencrane`, so one can never be replayed as the other.
Verification is strict — wrong type, wrong audience, bad signature, or a lease outside its ±5-minute
issue window returns `null`. Invariant: a genuine, unexpired, correctly-typed token is the only thing
that opens each gate; anything else fails closed, so a forged slip can never authorise a write and a
forged receipt can never finalise a catalog entry.

## Public surface

- `__SignArtifactWriteLease(claims, privateKeyPem, now)` / `__VerifyArtifactWriteLease(compact, publicKeyPem, now)` — mint and check the pre-upload permission slip.
- `__SignArtifactReadLease(claims, privateKeyPem, now)` / `__VerifyArtifactReadLease(compact, publicKeyPem, now)` — mint and check the operation-bound permission to stream one exact canonical address.
- `__SignArtifactPromotionReceipt(claims, privateKeyPem)` / `__VerifyArtifactPromotionReceipt(compact, publicKeyPem)` — mint and check the post-upload proof.
- `ArtifactWriteLeaseClaims` / `ArtifactReadLeaseClaims` / `ArtifactPromotionReceiptClaims` — the exact fields carried by each token.

## Boundary

Used by OpenCrane (to sign leases and verify receipts) and by `artifact-service` (to verify leases and
sign receipts). It is pure signing and verification: it holds no filesystem, no database, and no HTTP.
It does not decide *whether* a caller should get a lease — that authorisation happens upstream; this
package only makes the decision unforgeable.

The signed read-leases form the private contract for the future preprocessor/dispatch consumer. This
package does not grant that workload network access or issue its lease today; the consumer's app chart,
explicit NetworkPolicies, and server-side issuance authority are a subsequent slice. Until then,
artifact-service remains reachable only from the OpenCrane server.

## Dependency direction

Tagged `scope:artifacts`: it may depend only on `scope:artifacts` and `scope:shared` — never on apps
or sibling domains.

## See also

- Parent index: [artifacts](../../README.md)
- Siblings: [store](../../store/main/README.md) · [filesystem](../../filesystem/main/README.md)
