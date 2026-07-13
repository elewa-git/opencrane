# ClusterTenant manager configuration reference

**The opencrane-server (clustertenant-manager) runs in each silo and serves the tenant-facing API, auth, permissions, and organization data.** This reference documents every Helm configuration key under `clustertenantManager`, with defaults from `apps/opencrane-infra/values.yaml`.

> See also:
> [Silo deployment model](/operators/silo-deployment) — fleet vs silo topology and the deploy sequence.
> [Fleet and silo operating model](/operators/fleet-silo-model) — what the clustertenant-manager owns.

---

## Deployment & scaling

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.image.repository` | `ghcr.io/italanta/opencrane-server` | Container image registry and name. |
| `clustertenantManager.image.tag` | `latest` | Image tag. Pinned at deploy time via `--opencrane-ui-tag` (image tags must be restated per invocation because `--reset-then-reuse-values` re-applies chart defaults for unsupplied keys). |
| `clustertenantManager.image.pullPolicy` | `IfNotPresent` | Image pull policy; `Always` forces a pull on every pod start. |
| `clustertenantManager.replicas` | `1` | Number of clustertenant-manager pod replicas. Increase for HA; the Helm chart does not currently auto-scale based on load. |
| `clustertenantManager.resources.requests.cpu` | `100m` | CPU request per pod (allocated guarantee). |
| `clustertenantManager.resources.requests.memory` | `128Mi` | Memory request per pod (allocated guarantee). |
| `clustertenantManager.resources.limits.cpu` | `500m` | CPU hard limit per pod. |
| `clustertenantManager.resources.limits.memory` | `512Mi` | Memory hard limit per pod. |

---

## Network & APIs

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.service.port` | `8080` | Public API port (ingress-facing) serving `/api/v1/*` and `/auth` routes. Session-authed. |
| `clustertenantManager.service.internalPort` | `8081` | Internal API port serving tokenless `/api/internal/*` routes (tenant-models, contract, bundles, participation). The ingress never routes to this port; NetworkPolicy restricts it to platform pods only. Splitting internal and public APIs onto separate ports keeps the internal surface off the internet. |

---

## Database

The per-silo Postgres connection used by the clustertenant-manager and operator. Each silo gets its own CNPG `Cluster` CR; the manager connects to its own database only.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.database.url` | `""` | Direct PostgreSQL connection string (use `existingSecret` in production). Empty when using `existingSecret`. |
| `clustertenantManager.database.existingSecret` | `""` | Name of an existing Kubernetes Secret containing the `DATABASE_URL` connection string (preferred for production). |
| `clustertenantManager.database.secretKey` | `DATABASE_URL` | Key within `existingSecret` holding the connection string. |

::: info Environment variable
Set to the container as `DATABASE_URL`. Rendered into the clustertenant-manager and operator deployments.
:::

---

## Database migrations

The Prisma migration Helm hook that runs `prisma migrate deploy` as a pre-install/pre-upgrade Job.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.migrationJob.enabled` | `true` | When true, renders a Job that runs schema migrations before the opencrane-server pod starts. Reconciles the database schema even when the pod template is unchanged (a plain `helm upgrade` without this would not roll the pod, leaving the schema behind). |
| `clustertenantManager.migrationJob.backoffLimit` | `3` | Number of retries before the migration Job fails (fails the entire deploy). |

---

## Fleet integration

Settings for connecting this silo to the fleet's authoritative registry and API.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.manageTenantNamespaces` | `false` | Whether this silo OWNS per-ClusterTenant namespace creation. Default false: the fleet-manager creates and owns each org's namespace, and the silo SA is granted no cluster-scoped `namespaces` RBAC. Set true ONLY for a standalone (non-fleet-managed) silo so it can create its own org namespaces. |
| `clustertenantManager.fleetInternalUrl` | `""` | Fleet internal API base URL (e.g. `http://<fleet-fullname>-fleet-manager.<fleet-namespace>.svc:8080`). Empty = STANDALONE: the silo owns membership locally, and fleet→silo membership mirroring + first-login adoption write-through both idle. A fleet-managed silo MUST set this — without it, member adoptions never reach the fleet's authoritative registry and login-path seat caps are unenforced. |
| `clustertenantManager.fleetApiToken` | `""` | Bearer token presented to the fleet internal API (the fleet's `OPENCRANE_API_TOKEN` — one shared service credential). Inline only for development. |
| `clustertenantManager.fleetApiTokenExistingSecret` | `""` | Name of an existing Kubernetes Secret holding the fleet API token (preferred in production). |
| `clustertenantManager.fleetApiTokenSecretKey` | `token` | Key within `fleetApiTokenExistingSecret` holding the token. |

---

## Cognee (retrieval & memory)

Cognee integration for opencrane-server permission synchronization and tenant-isolation ACLs. Cognee is a required service: the opencrane-server's permission sync and the awareness retrieval ACL both depend on it.

### Install & endpoint

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.cognee.install` | `true` | Install an in-cluster Cognee Deployment as part of this release. A fresh cluster gets a working Cognee with no extra step. Set false to bring your own (BYO): the `endpoint` below then points at your external Cognee and no workload is rendered. Separate from `backendAccessControl` so an operator can BYO Cognee while still enforcing the backend ACL. |
| `clustertenantManager.cognee.endpoint` | `http://cognee:8000` | Cognee HTTP endpoint used by opencrane-server permission sync routes. When `install` is true, the in-chart Service is reachable at this name. Point it elsewhere only when BYO (`install: false`). |
| `clustertenantManager.cognee.backendAccessControl` | `true` | Enable Cognee backend access controls (tenant isolation + RBAC enforcement). Defaults true: the bundled Cognee makes this a real, enforced default rather than a latent gap. |
| `clustertenantManager.cognee.permissionsTimeoutMs` | `5000` | Permission sync timeout in milliseconds. Calls to Cognee that exceed this duration are cancelled. |

### Image & container

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.cognee.image.repository` | `cognee/cognee` | Cognee container image repository. |
| `clustertenantManager.cognee.image.tag` | `1.2.1` | Cognee image tag. Pinned to an audited stable tag for supply-chain integrity and reproducible deploys. Bump deliberately after re-auditing; never use a rolling `latest`. |
| `clustertenantManager.cognee.image.pullPolicy` | `IfNotPresent` | Image pull policy; `Always` forces a pull on every pod start. |
| `clustertenantManager.cognee.service.port` | `8000` | Port on the Cognee Service. |
| `clustertenantManager.cognee.resources.requests.cpu` | `100m` | CPU request per Cognee pod. |
| `clustertenantManager.cognee.resources.requests.memory` | `256Mi` | Memory request per Cognee pod. |
| `clustertenantManager.cognee.resources.limits.cpu` | `1` | CPU hard limit per Cognee pod. |
| `clustertenantManager.cognee.resources.limits.memory` | `1Gi` | Memory hard limit per Cognee pod. |

### Persistence

Cognee's identity/relational database, graph, and vector stores are persisted on a PVC so they survive pod restarts. Without this, all state lives on the pod's ephemeral filesystem and is wiped on restart, resetting org memory and orphaning per-tenant Cognee logins.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.cognee.persistence.enabled` | `true` | Enable persistent volume for Cognee state. |
| `clustertenantManager.cognee.persistence.size` | `10Gi` | Size of the Cognee data volume. Grow-only: the GKE default StorageClass allows online resizing, so bump this + redeploy to grow (never shrinks). |
| `clustertenantManager.cognee.persistence.storageClassName` | `""` | StorageClass for the volume. Empty ⇒ the cluster default (on GKE: `standard-rwo`, a PD-backed, expandable ReadWriteOnce class). Set explicitly for on-prem or other clouds. |

### LLM & embedding models

Cognee's own embedding and LLM (graph-extraction) providers, routed through this release's LiteLLM proxy via a dedicated virtual key the operator mints at boot. Cognee's spend is tracked as its own identity, never folded into a tenant's budget. Only rendered when `litellm.enabled` is true; without it, Cognee has no credentials and every memory-capture attempt aborts after ~60s of failed embedding calls.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.cognee.llm.provider` | `openai` | Cognee's chat LLM provider. `openai` matches Cognee's default and this platform's litellm-proxy convention for OpenAI-compatible upstreams. |
| `clustertenantManager.cognee.llm.model` | `openai/auto` | Cognee's chat model. `auto` is this platform's stable model-selection alias, seeded by BYOK bootstrap and resolving to the platform's cheapest chat model (e.g. `openai/gpt-5.4-nano` on opencrane-dev). MUST carry the `openai/` prefix so litellm can resolve the provider. |
| `clustertenantManager.cognee.embedding.provider` | `openai_compatible` | Cognee's embedding provider. `openai_compatible` (not `custom`) selects OpenAICompatibleEmbeddingEngine, which sends the model name verbatim and normalises the endpoint to `.../v1/embeddings`. |
| `clustertenantManager.cognee.embedding.model` | `auto-embedding` | Cognee's embedding model. `auto-embedding` is this platform's stable embedding-selection alias, pointing at the configured provider's real embedding model (not a tenant-selectable ModelDefinition). This exact string MUST match the platform constant; re-pointing the backing embedding model needs no edit here. |
| `clustertenantManager.cognee.embedding.dimensions` | `3072` | Embedding vector dimension. Must match the embedding model's output dimension. |

### Pod annotations

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.cognee.podAnnotations` | `{}` | Extra pod-template annotations. A sanctioned, script-driven rollout trigger: Cognee's LiteLLM key Secret is minted by the operator at runtime (not Helm-templated), so a plain `helm upgrade` has no checksum to roll Cognee when the key changes. Bump this (e.g. `--set clustertenantManager.cognee.podAnnotations.restartedAt=<value>`) to force a restart without touching kubectl/helm directly. |

---

## OIDC & authentication

Per-org OIDC session config for the opencrane-server. Zitadel is the single trusted issuer (Mode-2 broker, no upstream Entra), but any spec-compliant OIDC issuer works. OIDC is off unless `issuerUrl` is set.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.oidc.issuerUrl` | `""` | OIDC issuer URL for discovery (e.g. `https://weownai-oidc-8dwlat.eu1.zitadel.cloud`). Rendered as `OIDC_ISSUER_URL`. Empty ⇒ OIDC disabled; the cluster-tenant API falls back to development (open) auth. |
| `clustertenantManager.oidc.clientId` | `""` | Registered OAuth client ID (e.g. `123456789@weownai.iam.zitadel.cloud`). Rendered as `OIDC_CLIENT_ID`. |
| `clustertenantManager.oidc.redirectUri` | `""` | Callback URL on the opencrane-server (e.g. `https://<opencrane-server-host>/api/v1/auth/callback`). Rendered as `OIDC_REDIRECT_URI`. Must match the registered redirect_uri in your OIDC provider. |
| `clustertenantManager.oidc.existingSecret` | `""` | Name of an existing Kubernetes Secret carrying the OIDC client secret and session secret (strongly preferred over inline values in production). |
| `clustertenantManager.oidc.clientSecretKey` | `OIDC_CLIENT_SECRET` | Key within `existingSecret` holding the OIDC client secret. |
| `clustertenantManager.oidc.sessionSecretKey` | `OIDC_SESSION_SECRET` | Key within `existingSecret` holding the session secret. |
| `clustertenantManager.oidc.clientSecret` | `""` | Inline OIDC client secret (dev-only fallback when `existingSecret` is not set). Leave empty in production and use `existingSecret` instead. Rendered as `OIDC_CLIENT_SECRET`. |
| `clustertenantManager.oidc.sessionSecret` | `""` | Inline session secret (dev-only fallback when `existingSecret` is not set). Leave empty in production and use `existingSecret` instead. Rendered as `OIDC_SESSION_SECRET`. |
| `clustertenantManager.oidc.groupsClaim` | `groups` | Claim name carrying the caller's group memberships. Defaults match the Zitadel loader; override for your Zitadel claim mapping. Rendered as `OIDC_GROUPS_CLAIM`. |
| `clustertenantManager.oidc.rolesClaim` | `roles` | Claim name carrying the caller's roles. Defaults match the Zitadel loader; override for your Zitadel claim mapping. Rendered as `OIDC_ROLES_CLAIM`. |
| `clustertenantManager.oidc.platformOperatorGroups` | `""` | Comma-separated, lowercased group names that grant platform-operator (the super-admin role across this silo). Empty ⇒ nobody is granted via groups (fail-closed). Rendered as `OPENCRANE_PLATFORM_OPERATOR_GROUPS`. |
| `clustertenantManager.oidc.orgAdminGroups` | `""` | Comma-separated, lowercased group names that grant org-admin (within the caller's own org). Empty ⇒ nobody is granted via groups (fail-closed). Rendered as `OPENCRANE_ORG_ADMIN_GROUPS`. |
| `clustertenantManager.oidc.platformOperatorSeedEmail` | `""` | Bootstraps the FIRST platform operator before any IdP group mapping exists. A caller whose verified email equals this (case-insensitive) becomes a platform operator. MUST stay empty unless you are seeding an operator — an empty seed grants operator to NOBODY (fail-closed). Set it per cluster at install (the wizard can prompt for it); never commit a real email into values. Rendered as `OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL`. |

::: warning Zitadel management separated
The silo's OIDC above is for per-org **login only** and never holds the IAM_OWNER service-account key. Zitadel management (per-org provisioning + SA-key rotation) moved to `fleetManager.zitadel` (handled by the fleet-manager, which is the sole IAM_OWNER holder). The silo uses standards-only OIDC discovery at `issuerUrl` and makes no Zitadel management API calls.
:::

---

## Ingress same-origin routing

Same-origin hosting is the only mode: the opencrane-server host's Ingress serves the org-admin SPA at `/`, the public API at `/api`, and the OpenClaw gateway WS proxy at `/gateway` (when `gatewayProxy.enabled`) from one origin, so the browser gets first-party cookies with no CORS. Helm owns these rules, so the frontend layer never kubectl-patches the Ingress out-of-band. The legacy `*.<domain>` wildcard Ingress and the bare `/`→opencrane-server layout were removed once every silo migrated.

| Key | Default | Purpose |
|-----|---------|---------|
| `ingress.sameOrigin.spaService` | `weownai-opencrane-ui` | Name of the same-origin SPA Service that owns `/`. Applied by the frontend layer (e.g. WeOwnAI's `platform/k8s/frontend-opencrane-ui.yaml`). If the Service is absent, `/` returns 502 while `/api` and `/gateway` keep working. |
| `ingress.sameOrigin.spaPort` | `80` | Port on the SPA Service. |

---

## Related environment variables

The chart renders these environment variables into the clustertenant-manager and operator deployments. Set them via Helm values above; do not set them by hand.

| Variable | Source |
|----------|--------|
| `DATABASE_URL` | `clustertenantManager.database.existingSecret` or `url` |
| `OIDC_ISSUER_URL` | `clustertenantManager.oidc.issuerUrl` |
| `OIDC_CLIENT_ID` | `clustertenantManager.oidc.clientId` |
| `OIDC_REDIRECT_URI` | `clustertenantManager.oidc.redirectUri` |
| `OIDC_CLIENT_SECRET` | `clustertenantManager.oidc.existingSecret` (key `clientSecretKey`) or `clientSecret` |
| `OIDC_SESSION_SECRET` | `clustertenantManager.oidc.existingSecret` (key `sessionSecretKey`) or `sessionSecret` |
| `OIDC_GROUPS_CLAIM` | `clustertenantManager.oidc.groupsClaim` |
| `OIDC_ROLES_CLAIM` | `clustertenantManager.oidc.rolesClaim` |
| `OPENCRANE_PLATFORM_OPERATOR_GROUPS` | `clustertenantManager.oidc.platformOperatorGroups` |
| `OPENCRANE_ORG_ADMIN_GROUPS` | `clustertenantManager.oidc.orgAdminGroups` |
| `OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL` | `clustertenantManager.oidc.platformOperatorSeedEmail` |
| `MANAGE_TENANT_NAMESPACES` | `clustertenantManager.manageTenantNamespaces` |
| `COGNEE_ENDPOINT` | `clustertenantManager.cognee.endpoint` |
| `COGNEE_BACKEND_ACCESS_CONTROL` | `clustertenantManager.cognee.backendAccessControl` |
| `COGNEE_PERMISSIONS_TIMEOUT_MS` | `clustertenantManager.cognee.permissionsTimeoutMs` |
| `COGNEE_LLM_PROVIDER` | `clustertenantManager.cognee.llm.provider` |
| `COGNEE_LLM_MODEL` | `clustertenantManager.cognee.llm.model` |
| `COGNEE_EMBEDDING_PROVIDER` | `clustertenantManager.cognee.embedding.provider` |
| `COGNEE_EMBEDDING_MODEL` | `clustertenantManager.cognee.embedding.model` |
| `COGNEE_EMBEDDING_DIMENSIONS` | `clustertenantManager.cognee.embedding.dimensions` |
