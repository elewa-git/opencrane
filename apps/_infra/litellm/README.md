# litellm — vendored model proxy / gateway

> [apps](../../README.md) › [_infra](../README.md) › litellm

<!-- A vendored-infra app: a pinned third-party product we run and wrap in Helm. No import
     alias — the deliverable is a Helm named-template library. Named by `project.json` (`litellm`). -->

## What it owns

A **vendored infra app** owns the image assembly and deployment of a third-party product.
This one wraps [LiteLLM](https://github.com/BerriAI/litellm), a proxy that gives every model provider
(OpenAI, Anthropic, and others) one uniform API and one place to route, key, and meter calls.

**Why we run it.** All model traffic in a **silo** (one customer's isolated slice) flows through LiteLLM
so keys stay in-cluster, spend is metered in one place, and the assistants never talk to a provider
directly. Customers bring their own keys (BYOK) at the ClusterTenant level. This app owns the
release-local LiteLLM `Deployment`, `ServiceAccount`, `Service`, generated `Secret`, and app-owned `NetworkPolicy` as named Helm templates,
composed by the silo umbrella chart ([`deploy-k8s`](../deploy-k8s/README.md)).

## Public surface

`Entrypoint:` the Helm named-template library under `helm/`. The umbrella chart includes the
deployment, service account, service, Secret, and `opencrane.litellm.networkPolicy` templates.
`deploy/Dockerfile` builds `opencrane-litellm`; its build-time installer selects the model-routing
library's processor, rate limiter and startup registration at three hash-checked vendor binding points.

## Boundary

OpenCrane owns *how* LiteLLM is deployed, keyed, and reached; the vendor owns routing and provider
integration. **Shared mode** (`opencrane.litellmShared`) renders none of the managed resources and
points the silo at a configured shared endpoint and credentials instead. Secrets are sourced from
mounted/existing Kubernetes Secrets, never inlined.

The managed proxy has a dedicated release-local service account with no rendered Kubernetes API
grants. Automatic token mounting is disabled on both the account and Pod; no API token is projected.
Its model requests still require LiteLLM credentials. The service account is not a model permission.

## Dependency direction

An app entrypoint (`type:app`, `scope:litellm`); composed by the silo chart, imported by no package.
The derived image copies Python from `backend-server-model-routing`. Nx records this dependency
explicitly because a Docker `COPY` does not create a TypeScript import edge. Request processing,
proof signing and limiter behaviour belong to that library, not this deployment app.

## Runtime & config

- **Pinned image:** `ghcr.io/berriai/litellm-non_root:main-v1.81.0-stable` (the `non_root` wolfi-free
  build — the plain wolfi image crashes Prisma).
- `litellm.enabled` / `opencrane.litellmShared` — render an in-cluster workload, or use a shared endpoint.
- `litellm.masterKey` / `litellm.existingSecret` (+ `secretKey`) — the LiteLLM master key.
- `litellm.databaseUrl` / `litellm.existingDatabaseSecret` (+ `databaseSecretKey`) — Postgres connection
  from [`apps/postgres`](../../postgres/README.md).
- `litellm.storeModelInDb` — DB-backed model store (BYOM); requires the database URL above, OFF unless a
  DB profile turns it on. When on, `LITELLM_SALT_KEY` (from `litellm.existingSaltSecret`) encrypts stored
  provider keys and must never be rotated, or those keys become unreadable.
- `litellm.image.*`, `.podAnnotations`, `.service.port` — image, restart, and port controls.
- `litellm.image.digest` — optional published SHA-256 digest, selected instead of the tag.
- `litellm.preforwardRejectionContract` — empty by default. The only supported value is
  `opencrane.preforward-rate-limit.v1`; it requires managed same-release LiteLLM, repository
  `ghcr.io/elewa-git/opencrane-litellm`, and an explicitly qualified published image digest. The
  chart emits `LITELLM_PREFORWARD_CONTRACT` and `LITELLM_PREFORWARD_ENDPOINT` together for the
  server, using its existing canonical release-local endpoint. Shared, disabled, custom-image
  and unpinned qualification requests fail chart rendering. Publishing and qualifying an image
  remain separate gates: this source change does not enable the contract or change the deployed image.
- The app-owned policy admits same-release OpenCrane and Cognee on the service port. OpenCrane owns
  model requests for conversation turns; conversation-computer Pods receive no model input or direct
  LiteLLM ingress allowance. Their own policy also denies direct model egress. The LiteLLM policy remains active whenever Agent
  Sandbox is enabled. Egress is limited to PostgreSQL,
  DNS when enabled, and TLS provider APIs; coarse platform policies exclude LiteLLM so they cannot
  widen this boundary.
- `litellm.redis.enabled=true` is rejected while this network boundary is active. Redis needs a
  separately designed exact workload and egress identity; a hostname and port alone are not enough
  to widen model-router egress.

## Validation

Run `npx nx run litellm:test` for the smoke runner's success and failure contracts, and
`npx nx run litellm:lint` for its syntax checks. These local targets do not start Docker.
The silo chart's platform-network contract checks the proxy's identity, absence of API tokens and
absence of rendered grants in local and multi-instance profiles. App-template tests cover managed,
shared and disabled modes independently: the full silo still rejects shared LiteLLM while private
Cognee is installed. Negative tests reject missing identities, token mounts and grants. These
checks do not audit pre-existing cluster role bindings.
The existing GitHub Actions image-smoke job runs `npx nx run litellm:image-smoke`. It reports the
configured deployment image, pulls the immutable Linux/amd64 base in `deploy/image-source.json`,
and builds this checkout's derived image. The build preserves the pinned non-root user, vendor
entrypoint and command; it only copies the owned library and installs the reviewed bindings.
The runner verifies that runtime identity, reports the built content ID, then runs both the router
and pre-forward harnesses against that same ID with network access disabled, a read-only root,
no capabilities and only temporary `/tmp` storage. It requires both complete machine receipts;
successful exit, partial cases and the local source-fixture receipt cannot pass image qualification.
Changes to this app, the model adapter or its registration code, or the configured image select
the smoke through Nx. The container target registers the owned image with existing image CI.

The contract counts calls for rate limits, server errors, timeouts and connection loss. It compares
the vendor defaults with OpenCrane's fixed request controls and exercises fallback suppression.
It also records how deployment-level and named retry policies override request controls. This is
router-level evidence. The second harness imports the actual installed proxy server, verifies that
the owned processor and first limiter were selected, then exercises local rejection, provider
errors, callback spoofing, re-entry and receipt tampering with an in-memory provider. Neither
offline harness proves live-provider or durable conversation recovery. The server accepts proof
only for its explicitly configured managed origin, bound to the physical request and current
attempt credential. This does not add on-path protection to existing in-cluster bearer transport;
shared or external qualification needs a separately authenticated transport design.

Qualification is still pending. The strengthened startup harness exposed callback-preservation
assertions that assumed every newly constructed logger was registered. The pinned callback manager
instead retains an existing equivalent logger. The test now checks its registration key and still
requires all earlier callback instances in order, but this correction has not run in the full proxy.
No complete pre-forward receipt has been accepted from a built image.
Do not enable the contract on the strength of the TypeScript adapter or controlled-port recovery
tests. The local vendor copies and Python proof environments were removed during disk cleanup;
image-backed qualification belongs in the existing GitHub Actions job, not a local VM.

## See also

- Parent index: [_infra](../README.md)
- Silo chart that composes it: [deploy-k8s](../deploy-k8s/README.md)
- Database it uses: [apps/postgres](../../postgres/README.md)
- Sibling infra: [cognee](../cognee/README.md)
