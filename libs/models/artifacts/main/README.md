# @opencrane/models/artifacts — content-addressed artifact types and invariants

> [models](../../README.md) › artifacts

## What it owns

A **model** package is shared TypeScript types plus pure predicate functions — no database, no
network. This one describes an **artifact**: any stored piece of content the platform tracks — a
document, a generated file, an uploaded file, or a skill bundle — and the rules that keep those
records honest.

The core idea is **content addressing**: instead of naming bytes by a mutable path, an artifact
revision is pinned to a `sha256:<hex>` digest of its exact bytes. The same content always has the
same address, and any change produces a new address, so a revision can never be silently altered.

It owns:

- **Types**: `Artifact` (the stable logical thing), `ArtifactRevision` (one immutable, content-
  addressed version with its parents), `ArtifactContentReference` (address + byte length + media
  type), `ArtifactRevisionReference` (a storage-neutral pointer another model can hold), and
  `SkillRevision` (a skill pinned to one artifact-revision bundle).
- **Predicates** (`___Is…`) that check each shape is internally valid — a well-formed content
  address, a non-negative byte length, a media type containing `/`, a canonical ISO-8601 timestamp,
  parent revisions that are unique and never self-referential — plus
  `___SkillRevisionMatchesArtifactRevision`, which confirms a skill points at exactly the artifact
  revision it claims (same id and same digest).

Used by the artifacts backend, skills, and personal-memory domains, and re-exported through
`@opencrane/contracts`. Invariant: a revision is immutable and self-consistent — its bytes match its
address, and its links point where they say. If a predicate wrongly passes, downstream storage could
trust mismatched content; the predicates are therefore strict and fail closed on anything malformed.

## Public surface

- Types: `Artifact`, `ArtifactRevision`, `ArtifactContentReference`, `ArtifactRevisionReference`,
  `SkillRevision`, `ArtifactKind`, and the `*Id` aliases.
- Predicates: `___IsSha256ContentAddress`, `___IsArtifact`, `___IsArtifactRevision`,
  `___IsArtifactContentReference`, `___IsArtifactRevisionReference`, `___IsSkillRevision`,
  `___SkillRevisionMatchesArtifactRevision`, and `___SHA256_CONTENT_ADDRESS_PATTERN`.

## Boundary

Pure and I/O-free: it defines shapes and validates them; it does not store bytes, compute digests
from content, or talk to any storage backend. Callers do the hashing and persistence.

## Dependency direction

Tagged `scope:artifacts` (`layer:model`): it may depend only on other `scope:artifacts` and
`scope:shared` packages — never on apps, backend domains, or other model domains.

## See also

- Parent index: [models](../../README.md)
- Siblings: [agents](../../agents/main/README.md) · [authorization](../../authorization/main/README.md)
