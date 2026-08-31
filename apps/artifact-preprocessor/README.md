# artifact-preprocessor — isolated PDF text worker

> [apps](../README.md) › artifact-preprocessor

The artifact preprocessor is an outbound-only app that turns one authorised PDF into searchable plain
text. It has temporary scratch storage and a rotating Kubernetes ServiceAccount token, but no
database, ArtifactStore address, persistent volume, signing key, lease, or receipt.

## What it owns

The app validates its resource ceilings, exchanges one controller-created bootstrap reference,
creates the OpenCrane-only remote adapter and shell-free Poppler converter, and handles that one
assignment. OpenCrane chooses the source revision, brokers both byte directions, and decides whether
the derived text may be published.

```
 OpenCrane server ........ claim + PDF stream
       │                          ▲ text stream / bounded failure
       ▼                          │
 ┌────────────────────────────────────────────────────┐
 │ artifact-preprocessor  ◄── HERE                     │
 │ emptyDir only · projected token · pdftotext only   │
 └────────────────────────────────────────────────────┘
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[artifact authority](../../libs/backend/server/agents/artifacts/main/README.md) ·
[preprocessor library](../../libs/backend/artifacts/preprocessor/main/README.md)

Invariant: the worker can neither choose nor address an artifact. Every source, output, and failure
request is authenticated and fenced by the server-issued attempt. Local source and output files are
removed after success, failure, or cancellation.

## Public surface

`src/index.ts` is the sole entrypoint. It starts telemetry first, validates configuration, reads the
opaque reference mounted by its Kubernetes Job, processes exactly one assignment, and flushes
telemetry. The app exposes no HTTP listener, Deployment, Service, Ingress, or Kubernetes API
permission. The agent controller creates a new suspended Job for every durable workflow task.

## Boundary

The app may call only the same-silo OpenCrane internal listener. OpenCrane TokenReviews its projected
token for the exact ServiceAccount and audience before returning work or bytes. The worker never
calls artifact-service and never receives an ArtifactStore URL, content address, signed lease, or
promotion receipt.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:artifacts`. This thin app composes the artifact
preprocessor library and shared observability; catalogue, persistence, byte storage, and publication
remain server-owned.

## Runtime & config

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENCRANE_INTERNAL_URL` | Same-silo OpenCrane broker origin | Helm-derived |
| `OPENCRANE_PREPROCESSOR_TOKEN_PATH` | Rotating projected token file | required |
| `OPENCRANE_PREPROCESSOR_BOOTSTRAP_REFERENCE_PATH` | Opaque Job assignment reference file | required |
| `ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY` | Absolute bounded scratch path | required |
| `ARTIFACT_PREPROCESSOR_REQUEST_TIMEOUT_MS` | Per-request deadline | `10000` |
| `ARTIFACT_PREPROCESSOR_MAX_SOURCE_BYTES` | Maximum source PDF bytes | `33554432` |
| `ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES` | Maximum extracted text bytes | `16777216` |
| `ARTIFACT_PREPROCESSOR_CONVERSION_TIMEOUT_MS` | Maximum `pdftotext` duration | `30000` |

The container is built from `deploy/Dockerfile`, installs only Poppler in its runtime layer, runs as
an unprivileged user, and executes `dist/apps/artifact-preprocessor/index.js`.

## See also

- Parent index: [apps](../README.md)
- Fenced catalogue authority: [server artifacts](../../libs/backend/server/agents/artifacts/main/README.md)
- Worker protocol: [artifact preprocessor library](../../libs/backend/artifacts/preprocessor/main/README.md)
