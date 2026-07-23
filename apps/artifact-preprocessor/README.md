# artifact-preprocessor — fenced PDF text worker

> [apps](../README.md) › artifact-preprocessor

The artifact preprocessor is an **outbound-only deployable app**. It turns one authorized PDF into
plain UTF-8 text so an agent can search or reason over it, while keeping the ArtifactStore disk and
all signing/database authority outside the worker.

## What it owns

It owns only the bounded conversion step: poll one durable job, stream its exact source PDF into
temporary scratch space, invoke `pdftotext` without a shell, hash the resulting bytes, and present
them to the two authorities that decide whether they may become a real artifact.

```
 OpenCrane server .......... claim + source-read lease + output-write lease
       │                         ▲                     │ receipt completion
       ▼                         │                     ▼
 ┌─────────────────────────────────────────────────────────┐
 │ artifact-preprocessor  ◄── HERE                           │
 │ emptyDir only · projected token only · pdftotext only    │
 └──────────────┬───────────────────────────────────────────┘
                │ exact source read / exact output promotion
                ▼
       artifact-service ........ verifies capability · owns mounted CAS
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[artifact service](../artifact-service/README.md) ·
[artifact authority](../../libs/backend/server/agents/artifacts/main/README.md)

Invariant: the worker can never choose an artifact revision, issue a lease, sign a receipt, list the
CAS, or retain a source beyond one attempt. OpenCrane fences every claim with an attempt and random
claim fence; the artifact service accepts only the exact bytes covered by the server-signed output
lease. A crash or stale attempt merely expires for retry — it cannot overwrite a later result.

## Public surface

`src/index.ts` is the sole entrypoint. It imports telemetry first, reads mounted configuration,
creates the remote adapter and Poppler extractor, then runs a poll loop until `SIGTERM` or `SIGINT`.
The app does not expose HTTP, a Kubernetes Service, an Ingress, probes, RBAC, or a public API.

The reusable protocol lives in
[the artifact preprocessor library](../../libs/backend/artifacts/preprocessor/main/README.md): it reads
the projected token immediately before every OpenCrane call, validates the streamed PDF's byte length
and SHA-256 address before parsing it, and removes both transient files in a `finally` block. This app
only supplies its mounted configuration, converter/remote adapters, telemetry, and process shutdown.

## Boundary

The Helm chart mounts exactly two volumes: a projected `opencrane-artifact-preprocessor` audience token
and a bounded `emptyDir` at `/scratch`. It mounts no ArtifactStore PVC, database connection, key Secret,
or generic service-account token. The Pod is non-root, read-only, seccomp-confined, and has no inbound
networking. Its egress is limited to the same-silo OpenCrane internal listener, the selected
artifact-service Pod in its artifact namespace, cluster DNS, and the optional in-silo OTEL collector.

On the receiving side, artifact-service admits this exact release-labelled worker only; the server then
TokenReviews the token for the exact ServiceAccount and audience. Network access alone is therefore not
authority to claim or complete work.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:artifacts`. This thin app composes the artifact
preprocessor library and observability only. Catalog, fencing, signed capabilities, and receipt
verification live in the server artifact authority; byte storage and promotion stay in artifact-service.

## Runtime & config

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENCRANE_INTERNAL_URL` | Same-silo internal server origin | Helm-derived |
| `ARTIFACT_SERVICE_URL` | Private ArtifactStore origin | Helm-derived |
| `OPENCRANE_PREPROCESSOR_TOKEN_PATH` | Rotating projected token file | required |
| `ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY` | Absolute bounded scratch path | required |
| `ARTIFACT_PREPROCESSOR_POLL_INTERVAL_MS` | Idle or handled-error delay | `1000` |
| `ARTIFACT_PREPROCESSOR_REQUEST_TIMEOUT_MS` | Cap per authority/byte HTTP call | `10000` |
| `ARTIFACT_PREPROCESSOR_MAX_SOURCE_BYTES` | Maximum source PDF bytes | `33554432` |
| `ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES` | Maximum extracted UTF-8 text bytes | `16777216` |
| `ARTIFACT_PREPROCESSOR_CONVERSION_TIMEOUT_MS` | Cap for one `pdftotext` process | `30000` |

The container is built from `deploy/Dockerfile`, which installs only Poppler in its runtime layer and
executes `dist/apps/artifact-preprocessor/index.js`. Its Helm named-template library is composed by
[the silo release](../_infra/deploy-k8s/README.md). The chart refuses to render an enabled worker without
an immutable SHA-256 image digest.

## See also

- Parent index: [apps](../README.md)
- Source byte boundary: [artifact service](../artifact-service/README.md)
- Fenced catalog authority: [server artifacts](../../libs/backend/server/agents/artifacts/main/README.md)
