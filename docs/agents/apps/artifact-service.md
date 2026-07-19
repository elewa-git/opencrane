# App: artifact-service (`@opencrane/artifact-service`)

> Deep-dive for `apps/artifact-service`. Index: [`../app-specific.md`](../app-specific.md).

The guarded write path into OpenCrane's per-silo content-addressed artifact store (CAS). It is the
only process that admits artifact bytes, and only against a signed, short-lived write lease for one
exact artifact. The app is a deployable transport shell: store mechanics, lease/receipt
cryptography, and the promotion protocol live in `libs/backend/artifacts/{store,filesystem,authorization}`.

## Surface

The private listener exposes `POST /v1/artifacts/promote` and `/livez`/`/readyz`; every other route
is 404. The handler adapts an HTTP stream to `__PromoteArtifactUpload`, returning `201` with a
signed receipt on success, `413` for a body above its lease ceiling, and `403` with a typed reason
for other rejections. An absolute deadline destroys a still-streaming socket instead of extending
its disk-consumption window.

## Trust boundary

The service has no catalog database access or session state. An OpenCrane-signed lease binds the
action, artifact, expected digest, byte length, media type, and expiry. The service stages and
atomically promotes verified bytes, then signs the receipt that the catalog authority consumes to
publish immutable metadata. It cannot choose catalog state, and the catalog cannot claim a byte
write without the receipt.

## Deployment boundary

One deployment per silo mounts the durable CAS volume. It receives no Kubernetes RBAC and does not
auto-mount a service-account token. Its NetworkPolicy admits the OpenCrane server as a client and
allows only explicitly selected egress peers; `tests/helm-contract.sh` protects that boundary.
