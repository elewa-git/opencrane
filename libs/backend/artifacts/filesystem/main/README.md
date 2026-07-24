# @opencrane/backend/artifacts/filesystem — on-disk content-addressed store

> [backend](../../../README.md) › [artifacts](../../README.md) › filesystem

## What it owns

An **artifact** is a stored file or output named by the hash of its bytes. This package is the one
place those bytes actually live on disk: a POSIX-filesystem adapter that implements the `ArtifactStore`
port from [store](../../store/main/README.md). It is **CAS** — content-addressed storage — so a file's
only name is `sha256/<first-two-hex>/<full-digest>`, derived from the hash of its content and nothing
else. It owns the durability and integrity of the write, and the safety of every path it forms.

```
 store's promotion protocol
          │  stage(command)                   promote(staged)
          ▼                                        │
 ┌────────────────────────────────────────────────▼──────┐
 │   filesystem  ◄── HERE                                  │
 │   1. write bytes to a private 0600 staging file        │
 │   2. hash + fsync every chunk before accepting metadata │
 │   3. hard-link staged file to its canonical address     │
 └─────────────────────────────────────────────────────────┘
          │  canonical immutable object (created: true/false)
          ▼
 byteLength(address) confirms immutable size · read(address) streams it back · purge(address) removes it
```

**In this flow:** [store](../../store/main/README.md) *(defines the `ArtifactStore` port and validates every command)* ·
[authorization](../../authorization/main/README.md) *(issues the lease — a short-lived signed write permit — whose id seeds the staging path)*

Staging writes untrusted bytes to a private per-lease file (mode `0600`) under a `staging/`
directory, hashing and `fsync`-ing them as it goes, and rejects the upload if the computed digest or
length does not match what the lease authorised. Promotion is an **atomic publish by hard link**:
linking creates the canonical name only if no concurrent writer already owns it; if the name exists it
must still be a regular file of the exact size *and* re-hash to the exact digest, otherwise the call
fails rather than trust a same-named object. Directory entries are `fsync`-ed so a promotion survives a
crash.

Invariant, and why it matters: **every path is derived, never accepted.** The staging handle is a hash
of the lease id (validated `^[a-f0-9]{64}$`), the canonical path is rebuilt from a strictly validated
`sha256:` address, and the root must be absolute — so a caller can never smuggle `../` path traversal
in to read or overwrite a file outside the mounted volume, and stored bytes always equal their name.

## Public surface

- `__FilesystemArtifactStore` — the POSIX `ArtifactStore` adapter (`stage` · `promote` · `byteLength` · `read` · `purge`).
- `FilesystemArtifactStoreOptions` — construction options (the absolute `rootPath` of the mounted volume).

## Boundary

The sole storage adapter behind `artifact-service`, driven only by [store](../../store/main/README.md)'s
promotion protocol. It authenticates nothing and knows no catalog state — it trusts that `store` has
already validated the lease and command. It only ever writes below its one absolute root, and it purges
a canonical object only after the catalog authority has proven no reference remains.

## Dependency direction

Tagged `scope:artifacts`: it may depend only on `scope:artifacts` and `scope:shared` — never on apps
or sibling domains.

## Runtime & config

Requires one absolute `rootPath` pointing at the artifact-service mounted volume; it manages the
`staging/` and `sha256/` subtrees within it. No environment variables of its own.

## See also

- Parent index: [artifacts](../../README.md)
- Siblings: [store](../../store/main/README.md) · [authorization](../../authorization/main/README.md)
