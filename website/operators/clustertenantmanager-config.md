# ClusterTenant manager configuration reference

**The opencrane-api (clustertenant-manager) runs in each silo and serves the tenant-facing API, auth, permissions, and organization data.** This reference documents every Helm configuration key under `clustertenantManager`, with defaults from `apps/_infra/deploy-k8s/values.yaml`.

> See also:
> [Silo deployment model](/operators/silo-deployment) — fleet vs silo topology and the deploy sequence.
> [Fleet and silo operating model](/operators/fleet-silo-model) — what the clustertenant-manager owns.

---

## Deployment & scaling

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.image.repository` | `ghcr.io/elewa-git/opencrane-clustertenant-manager` | Container image registry and name. |
| `clustertenantManager.image.tag` | `latest` | Image tag. Pinned at deploy time via `--opencrane-server-tag` (image tags must be restated per invocation because `--reset-then-reuse-values` re-applies chart defaults for unsupplied keys). |
| `clustertenantManager.image.pullPolicy` | `IfNotPresent` | Image pull policy; `Always` forces a pull on every pod start. |
| `clustertenantManager.replicas` | `1` | Number of clustertenant-manager pod replicas. Increase for HA; the Helm chart does not currently auto-scale based on load. |
| `clustertenantManager.resources.requests.cpu` | `100m` | CPU request per pod (allocated guarantee). |
| `clustertenantManager.resources.requests.memory` | `128Mi` | Memory request per pod (allocated guarantee). |
| `clustertenantManager.resources.limits.cpu` | `500m` | CPU hard limit per pod. |
| `clustertenantManager.resources.limits.memory` | `512Mi` | Memory hard limit per pod. |

### Pod security

These defaults match the `node` user in the server image. The group-readable Secret mode is paired
with `fsGroup: 1000`; changing one side without the other can make projected ArtifactStore keys
unreadable or expose them more broadly than intended.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.podSecurityContext.runAsNonRoot` | `true` | Rejects a container that would run as uid 0. |
| `clustertenantManager.podSecurityContext.runAsUser` | `1000` | Runs the pod as the server image's `node` uid. |
| `clustertenantManager.podSecurityContext.runAsGroup` | `1000` | Runs the pod as the server image's `node` gid. |
| `clustertenantManager.podSecurityContext.fsGroup` | `1000` | Makes projected key volumes readable by the server group. |
| `clustertenantManager.podSecurityContext.fsGroupChangePolicy` | `OnRootMismatch` | Avoids recursive ownership changes when the volume root already has the expected group. |
| `clustertenantManager.podSecurityContext.seccompProfile.type` | `RuntimeDefault` | Applies the container runtime's default syscall filter. |
| `clustertenantManager.securityContext.allowPrivilegeEscalation` | `false` | Prevents the process from gaining more privileges than its parent. |
| `clustertenantManager.securityContext.capabilities.drop` | `[ALL]` | Drops every Linux capability. |
| `clustertenantManager.securityContext.readOnlyRootFilesystem` | `false` | Leaves the image root writable for current server runtime needs. |

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

::: info Database shape is fixed before application startup
The deploy engine publishes the reviewed target SQL as an immutable, content-addressed ConfigMap and
CloudNativePG applies it once during `initdb`. Physical recovery uses the schema and protected
baseline marker in the backup; a Postgres hook checks that marker before deployment continues. The
clustertenant-manager has no schema-update Job or startup mutation path.
:::

---

## Local lifecycle ownership

The control plane owns ClusterTenant lifecycle and membership locally.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.manageTenantNamespaces` | `true` | Whether this control plane creates per-ClusterTenant namespaces. Set false only when a separately managed namespace provisioner is explicitly responsible. |

---

## Cognee (retrieval & memory)

Cognee integration for opencrane-api permission synchronization and tenant-isolation ACLs. Cognee is a required service: the opencrane-api's permission sync and the awareness retrieval ACL both depend on it.

### Install & endpoint

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.cognee.install` | `true` | Install an in-cluster Cognee Deployment as part of this release. A fresh cluster gets a working Cognee with no extra step. Set false to bring your own (BYO): the `endpoint` below then points at your external Cognee and no workload is rendered. Separate from `backendAccessControl` so an operator can BYO Cognee while still enforcing the backend ACL. |
| `clustertenantManager.cognee.endpoint` | `http://cognee:8000` | Cognee HTTP endpoint used by opencrane-api permission sync routes. When `install` is true, the in-chart Service is reachable at this name. Point it elsewhere only when BYO (`install: false`). |
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

Per-org OIDC session config for the opencrane-api. Zitadel is the single trusted issuer (Mode-2 broker, no upstream Entra), but any spec-compliant OIDC issuer works. OIDC is off unless `issuerUrl` is set.

| Key | Default | Purpose |
|-----|---------|---------|
| `clustertenantManager.oidc.issuerUrl` | `""` | OIDC issuer URL for discovery (e.g. `https://weownai-oidc-8dwlat.eu1.zitadel.cloud`). Rendered as `OIDC_ISSUER_URL`. Empty ⇒ OIDC disabled; the cluster-tenant API falls back to development (open) auth. |
| `clustertenantManager.oidc.clientId` | `""` | Registered OAuth client ID (e.g. `123456789@weownai.iam.zitadel.cloud`). Rendered as `OIDC_CLIENT_ID`. |
| `clustertenantManager.oidc.redirectUri` | `""` | Callback URL on the opencrane-api (e.g. `https://<opencrane-api-host>/api/v1/auth/callback`). Rendered as `OIDC_REDIRECT_URI`. Must match the registered redirect_uri in your OIDC provider. |
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

Same-origin hosting is the only mode: the opencrane-api host's Ingress serves the org-admin SPA at `/`, the public API at `/api`, and the OpenClaw gateway WS proxy at `/gateway` (when `gatewayProxy.enabled`) from one origin, so the browser gets first-party cookies with no CORS. Helm owns these rules, so the frontend layer never kubectl-patches the Ingress out-of-band. The legacy `*.<domain>` wildcard Ingress and the bare `/`→opencrane-api layout are no longer rendered.

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
