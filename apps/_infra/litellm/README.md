# litellm — vendored model proxy / gateway

> [apps](../../README.md) › [_infra](../README.md) › litellm

<!-- A vendored-infra app: a pinned third-party product we run and wrap in Helm. No import
     alias — the deliverable is a Helm named-template library. Named by `project.json` (`litellm`). -->

## What it owns

A **vendored infra app** is a third-party product OpenCrane runs as-is and wraps in a Helm chart we own.
This one wraps [LiteLLM](https://github.com/BerriAI/litellm), a proxy that gives every model provider
(OpenAI, Anthropic, and others) one uniform API and one place to route, key, and meter calls.

**Why we run it.** All model traffic in a **silo** (one customer's isolated slice) flows through LiteLLM
so keys stay in-cluster, spend is metered in one place, and the assistants never talk to a provider
directly. Customers bring their own keys (BYOK) at the ClusterTenant level. This app owns the
release-local LiteLLM `Deployment`, `Service`, generated `Secret`, and app-owned `NetworkPolicy` as named Helm templates,
composed by the silo umbrella chart ([`deploy-k8s`](../deploy-k8s/README.md)).

## Public surface

`Entrypoint:` the Helm named-template library under `helm/`. The umbrella chart includes the
deployment, service, Secret, and `opencrane.litellm.networkPolicy` templates. No importable code.

## Boundary

OpenCrane owns *how* LiteLLM is deployed, keyed, and reached; the vendor owns routing and provider
integration. **Shared mode** (`opencrane.litellmShared`) renders none of the managed resources and
points the silo at a configured shared endpoint and credentials instead. Secrets are sourced from
mounted/existing Kubernetes Secrets, never inlined.

## Dependency direction

An app entrypoint (`type:app`, `scope:litellm`); composed by the silo chart, imported by no package.

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
- The app-owned policy admits only same-release OpenCrane and Cognee on the service port. The agent
  controller adds exact claimed warm-runtime peers separately. Egress is limited to PostgreSQL,
  DNS when enabled, and TLS provider APIs; coarse platform policies exclude LiteLLM so they cannot
  widen this boundary.
- `litellm.redis.enabled=true` is rejected while this network boundary is active. Redis needs a
  separately designed exact workload and egress identity; a hostname and port alone are not enough
  to widen model-router egress.

Tier 2 Alternative A reuses the pinned image in a labelled loopback container. The coordinator reads
the reviewed model/provider contract from
[`@opencrane/models/local-development`](../../../libs/models/local-development/main/provider-contract.json),
discovers matching owner-only provider-key files, and generates one secret-free ignored YAML for the
selected model under `local-development/` when it is first used. Matching generated files persist
across runs and retain the provider-neutral `auto` alias. Only the selected configuration is mounted
read-only and only its provider key enters the container environment. The coordinator generates a
separate local LiteLLM master key. Every reviewed provider uses the hidden
`keys/.<provider>-key` convention. `--provider` chooses a reviewed provider and its `defaultModel`;
`--model` can select another exact reviewed model owned by that provider.
Alternative B uses an explicit remote HTTPS LiteLLM origin and admin-key file; Alternative C starts
no LiteLLM process and reads no provider or model credential.

## See also

- Parent index: [_infra](../README.md)
- Silo chart that composes it: [deploy-k8s](../deploy-k8s/README.md)
- Database it uses: [apps/postgres](../../postgres/README.md)
- Sibling infra: [cognee](../cognee/README.md)
