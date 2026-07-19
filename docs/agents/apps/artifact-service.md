# App: artifact-service (`@opencrane/artifact-service`)

> Deep-dive for `apps/artifact-service`. Index: [`../app-specific.md`](../app-specific.md). Verified July 2026.

The **guarded write path into OpenCrane's content-addressed artifact store** (CAS). It is the only
process that admits bytes onto the artifact volume, and it admits them only against a signed,
short-lived write lease that OpenCrane issues for one specific artifact. The app is a thin
deployable shell: the store mechanics, lease/receipt cryptography, and the promote protocol all
live in `libs/backend/artifacts/{store,filesystem,authorization}`; the app owns process bootstrap,
configuration, the private HTTP listener, and its Helm unit.

## Surface (`src/server.ts`)

One route: `POST /v1/artifacts/promote`, plus `/livez` and `/readyz` (204). Everything else is 404 —
no read, list, or delete endpoint exists here. The handler adapts HTTP to
`__PromoteArtifactUpload(store, leaseVerifier, byteSource, config)`
(`libs/backend/artifacts/store/main/src/artifact-promotion.ts`) and translates its typed outcome:
`201` + promotion JSON + signed receipt, `413` when the body exceeds the lease's byte ceiling,
`403` with a typed reason for every other rejection, and a destroyed socket when the absolute
deadline expires mid-stream (a status would keep the connection consuming disk past the lease
bound).

## Protocol (lease in, receipt out)

The service holds no session state and no database access, so trust flows entirely through two
keys (`src/config.ts` reads both from mounted PEM paths, never raw env values):

1. **Lease verification** — the caller presents a compact lease in `x-opencrane-artifact-lease`,
   signed by OpenCrane (`ARTIFACT_LEASE_PUBLIC_KEY_PATH` verifies it). The lease binds one
   `artifact.write` action to an expected content digest, byte length, media type, and expiry.
2. **Stage → promote** — bytes are hashed and fsynced into private staging, then hard-linked
   atomically at `sha256/ab/<digest>`; the declared digest/length must match what was actually
   written (`libs/backend/artifacts/filesystem`). Promotion is idempotent per address.
3. **Receipt signing** — the service signs a promotion receipt
   (`ARTIFACT_RECEIPT_PRIVATE_KEY_PATH`), which is the only evidence OpenCrane accepts to finalize
   the catalog row. Upload duration is capped by both `ARTIFACT_MAX_UPLOAD_DURATION_MILLISECONDS`
   (default 300 000) and the lease expiry, whichever is sooner.

## Config (`src/config.ts`)

`PORT` (8080), `ARTIFACT_ROOT` (`/var/lib/opencrane/artifacts`, must be absolute — the mounted
PVC), `ARTIFACT_MAX_UPLOAD_DURATION_MILLISECONDS`, `ARTIFACT_LEASE_PUBLIC_KEY_PATH`,
`ARTIFACT_RECEIPT_PRIVATE_KEY_PATH`. All fail-closed: an invalid value throws at startup rather
than serving with a guessed default.

## Deploy boundary (`helm/templates/_resources.tpl`, `tests/helm-contract.sh`)

One Deployment per silo with the `artifact-service` ServiceAccount: **zero Kubernetes RBAC, no
auto-mounted API token**. One 20&nbsp;Gi PVC holds the whole silo's CAS — one shared store with
logical partitioning by digest, never a volume per authority or per agent (this is the
"one shared instance" shape ADR 0002/D1 also applies to Postgres). NetworkPolicy admits only the
OpenCrane server as client. `tests/helm-contract.sh` locks the no-RBAC contract. Durable artifact
data is retained across releases and grows by volume expansion, never by adding parallel stores
(ADR 0008 storage policy).
