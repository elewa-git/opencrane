# artifact-service — artifact promote & receipt service

> [apps](../README.md) › artifact-service

<!-- No `@opencrane/*` import alias: this is a deployable app, titled by its `project.json`
     name (`artifact-service`). -->

A **deployable app** is a thin process that composes backend libraries and ships as one container. This
one is the **artifact service**: the only process allowed to turn a caller's uploaded bytes into a
stored, permanent artifact. An *artifact* here is any file an agent or user produces — a document, an
image, a generated report.

## What it owns

It owns the write side of **content-addressed storage** (CAS — files are stored and named by a hash of
their own bytes, so identical content is stored once and every stored object is tamper-evident). Callers
never write to that store directly. Instead the OpenCrane server first issues a signed **write lease** —
a short-lived permission slip saying "these exact bytes, up to this size, may be stored" — and this
service is what checks the slip and does the write.

It is one step in the artifact-promotion flow, composing three artifact libraries:
[`store`](../../libs/backend/artifacts/store/main/README.md) (the promotion protocol),
[`authorization`](../../libs/backend/artifacts/authorization/main/README.md) (verify the lease, sign the
receipt), and [`filesystem`](../../libs/backend/artifacts/filesystem/main/README.md) (the on-disk CAS
backend).

```
 opencrane server ........ issues a signed write lease to the caller
        │
        ▼  POST /v1/artifacts/promote   (X-Opencrane-Artifact-Lease: <lease>, body = bytes)
 ┌────────────────────────────┐
 │  artifact-service  ◄── HERE │  verify lease → stream bytes into CAS → sign receipt
 └────────────────────────────┘
        │  201 { promotion, receipt }   ·   rejects an oversized or unsigned body
        ▼
   mounted CAS root  (/var/lib/opencrane/artifacts)
```

**In this flow:** [store](../../libs/backend/artifacts/store/main/README.md) ·
[authorization](../../libs/backend/artifacts/authorization/main/README.md) ·
[filesystem](../../libs/backend/artifacts/filesystem/main/README.md) ·
[opencrane server](../opencrane/README.md)

It is private and fails closed: a request with no lease, a forged or expired lease, or a body larger
than the lease permits is rejected and the upload aborted. On success it stores the bytes and returns a
signed **receipt** — proof the artifact was promoted — that the caller cannot forge. If it is wrong, it
can only refuse a legitimate upload; it can never store bytes that were not covered by a genuine lease.

## Public surface

`Entrypoint: src/index.ts` (`_Main`) — reads config, prepares the mounted CAS root (mode `0700`), opens
the listener, and binds bounded `SIGTERM`/`SIGINT` shutdown that drains requests and flushes telemetry.

HTTP endpoints: `POST /v1/artifacts/promote` (the one write operation) and `/livez` · `/readyz` probes.
Any other path or method is `404`.

## Boundary

Stateless apart from the mounted CAS volume. It does **not** issue leases (the server does), does not
read or list artifacts, and does not accept raw secrets as environment variables — signing keys are
mounted PEM files, not env values. Verification and signing are delegated to the artifacts libraries;
this process is only the HTTP adapter and byte pump around them.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:artifacts`. As an entrypoint it composes the artifact
backend libraries and `@opencrane/observability`; nothing imports it.

## Runtime & config

Read by `src/config.ts` at startup; the process refuses to start if a path is not absolute/mounted or a
key file is not PEM.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Listener port | `8080` |
| `ARTIFACT_ROOT` | Absolute mounted CAS directory | `/var/lib/opencrane/artifacts` |
| `ARTIFACT_LEASE_PUBLIC_KEY_PATH` | Mounted PEM public key used to verify write leases | *(required)* |
| `ARTIFACT_RECEIPT_PRIVATE_KEY_PATH` | Mounted PEM private key used to sign receipts | *(required)* |
| `ARTIFACT_MAX_UPLOAD_DURATION_MILLISECONDS` | Hard cap on a single upload's duration | `300000` |

Built into `dist/apps/artifact-service` by esbuild and imaged from `deploy/Dockerfile`
(`ghcr.io/elewa-git/opencrane-artifact-service`). Its Helm chart under `helm/` is a named-template
library composed by the silo umbrella chart
([`apps/_infra/deploy-k8s`](../_infra/deploy-k8s/README.md)).

## See also

- Parent index: [apps](../README.md)
- Composed libraries: [store](../../libs/backend/artifacts/store/main/README.md) ·
  [authorization](../../libs/backend/artifacts/authorization/main/README.md) ·
  [filesystem](../../libs/backend/artifacts/filesystem/main/README.md)
- Sibling apps: [channel-proxy](../channel-proxy/README.md) · [opencrane server](../opencrane/README.md)
