# @opencrane/backend/server/artifacts — Artifact revisions

Owns finalization of visible artifact metadata after ArtifactStore has promoted the bytes. It
checks the promotion evidence and commits the revision, current pointer, and delivery intent as
one durable result; it does not perform artifact byte I/O itself.

The public surface is `src/index.ts`; persistence is supplied through `ArtifactAuthorityRepository`.
See [`../../README.md`](../../README.md) for the control-plane map.
