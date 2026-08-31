# @opencrane/backend/artifacts/preprocessor — bounded PDF conversion worker

> [backend](../../../README.md) › [artifacts](../../README.md) › preprocessor

This backend library turns one server-authorised PDF into plain UTF-8 text without receiving any
storage address, lease, signing key, or receipt. The `artifact-preprocessor` app owns process
configuration and lifecycle; this package owns the reusable processing sequence and HTTP adapter.

## What it owns

The library claims a fenced job, asks OpenCrane to stream the claim's source into bounded scratch
space, runs a shell-free `pdftotext` process, checks the output file size before opening it, and
streams the text back to OpenCrane. OpenCrane—not this worker—hashes, stores, and publishes the
derived artifact.

```
 OpenCrane server ........ durable claim · source broker · output broker
       │                                      ▲
       │ PDF bytes                            │ text bytes
       ▼                                      │
 ┌─────────────────────────────────────────────────────────┐
 │ preprocessor library  ◄── HERE                           │
 │ bounded scratch · shell-free conversion · failure report│
 └─────────────────────────────────────────────────────────┘
```

**In this flow:** [server artifact authority](../../../server/agents/artifacts/main/README.md) ·
[artifact-preprocessor app](../../../../../apps/artifact-preprocessor/README.md)

Invariant: every read, output, and failure report carries the current attempt and opaque claim fence.
The worker never learns where artifact bytes live or receives a reusable storage capability. A stale
worker can therefore waste local conversion work, but it cannot read or publish an artifact.

## Public surface

- `__ProcessArtifactPreprocessorJob` — performs one source → convert → output sequence.
- `_CreateArtifactPreprocessorRemote` — creates the projected-token OpenCrane broker adapter.
- `_CreatePdfTextExtractor` — creates the Poppler adapter with fixed arguments and no shell.
- `ArtifactPreprocessorRemote`, `PdfTextExtractor`, and `ArtifactPreprocessorDependencies` — injected
  runtime and testing ports.

## Boundary

This package has no database client, Kubernetes client, ArtifactStore client, mounted persistent
volume, signing key, or catalogue lookup. It reads the rotating projected ServiceAccount token
immediately before each server request and never records that token or claim fence in logs or spans.
Source and output files are removed in a `finally` block after every attempt.

## Dependency direction

Tagged `type:lib`, `layer:backend`, and `scope:artifacts`. It may depend on shared contracts and
observability, never on an app or server implementation. The deployable app consumes this library in
one direction.

## See also

- Parent group: [artifacts](../../README.md)
- Authority: [server artifacts](../../../server/agents/artifacts/main/README.md)
- Deployable composition: [artifact-preprocessor app](../../../../../apps/artifact-preprocessor/README.md)
