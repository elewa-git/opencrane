# @opencrane/backend/artifacts/preprocessor — fenced PDF derivative protocol

> [backend](../../../README.md) › [artifacts](../../README.md) › preprocessor

This backend library owns the reusable protocol for turning one server-authorized PDF into one
server-authorized plain-text derivative. It deliberately contains the work sequence and capability
adapters, while the `artifact-preprocessor` app owns process configuration, lifecycle, and Helm.

## What it owns

The library claims a fenced job, streams the one signed source address into a bounded caller-provided
scratch directory, calls a shell-free converter port, hashes the exact UTF-8 result, requests an
output-write lease, promotes directly to ArtifactStore, and completes only with ArtifactStore's signed
receipt. Its remote adapter reads the projected token afresh for each authority request and validates
the source byte length and content address while it streams.

```
 OpenCrane authority .... claim · source-read lease · output-write lease
       │                                         ▲              │ receipt
       ▼                                         │              ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ preprocessor library  ◄── HERE                                │
 │ fenced orchestration · projected-token adapter · converter port│
 └─────────────────────────────┬────────────────────────────────┘
                               ▼
                     artifact-service byte boundary
```

**In this flow:** [server artifact authority](../../../server/agents/artifacts/main/README.md) ·
[artifact authorization](../../authorization/main/README.md) ·
[artifact store](../../store/main/README.md) ·
[artifact-preprocessor app](../../../../../apps/artifact-preprocessor/README.md)

Invariant: this library cannot issue a lease, select a catalog revision, sign a receipt, or list CAS
objects. It only presents the exact evidence each independent authority requires. A stale, failed, or
crashed attempt is harmless: the server's claim fence rejects its later output and the app removes its
transient source/output files.

## Public surface

- `__RunArtifactPreprocessor` — bounded poll loop for a process owner.
- `__ProcessArtifactPreprocessorJob` — one claim's read → convert → hash → lease → promote → complete sequence.
- `_CreateArtifactPreprocessorRemote` — projected-token HTTP and ArtifactStore capability adapter.
- `_CreatePdfTextExtractor` — production Poppler `pdftotext` adapter, invoked with argv rather than a shell.
- `ArtifactPreprocessorRemote`, `PdfTextExtractor`, and `ArtifactPreprocessorDependencies` — injected test and runtime ports.

## Boundary

This is a backend `scope:artifacts` library. It knows only transport-neutral capability inputs and
bounded local paths; it has no Kubernetes APIs, Helm values, database client, signing key, persistent
volume, or long-lived credential. The application configures source/output ceilings and supplies the
emptyDir path. The remote adapter does not log token or lease values, and trace fields include only
job IDs, attempts, paths, and byte sizes.

## Dependency direction

Tagged `type:lib`, `layer:backend`, `scope:artifacts`. It may depend on artifact/shared contracts and
observability, never on an app. The app is a one-way consumer; neither server catalog authority nor
artifact-service imports this worker protocol.

## See also

- Parent group: [artifacts](../../README.md)
- Authority: [server artifacts](../../../server/agents/artifacts/main/README.md)
- Byte boundary: [artifact service](../../../../../apps/artifact-service/README.md)
- Deployable composition: [artifact-preprocessor app](../../../../../apps/artifact-preprocessor/README.md)
