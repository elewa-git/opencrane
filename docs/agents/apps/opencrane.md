# App: opencrane (`@opencrane/server`)

> Deep-dive for `apps/opencrane`. Index: [`../app-specific.md`](../app-specific.md). Identity model:
> [`../architecture.md`](../architecture.md). Verified July 2026.

The **current per-silo control plane** — one instance per **ClusterTenant**, running in that org's own
namespace and served at the org host `<org>.<base>`. **Express 5 + Prisma (PostgreSQL) +
`@kubernetes/client-node`.** The target keeps this app as the business API and narrows it to target
Postgres authorities, identity, grants, MCP, agents, artifacts, approvals, and audit. Existing
OpenClaw, Tenant/AccessPolicy CRD, projection, pairing, and static-token responsibilities are direct
deletion targets, not contracts to preserve.
Listens on `PORT` (default **8080**).

This control plane owns its ClusterTenant lifecycle, platform DNS declarations, and per-org
identity configuration. It serves the org-scoped management surface and reads the cluster-scoped
`ClusterTenant` CR as the declared lifecycle contract. See
[`cluster-architecture.md` → Tenancy Model](../cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant).

## Layout

`apps/opencrane/src` is deliberately small and closed by
`docs/agents/app-source-allowlist.json`: process entrypoint/lifecycle composition, environment
configuration, route assembly, instrumentation/logging, Prisma construction, and the
hosting-adapter factory. The app also owns its Prisma schema, clean-database target baseline, and Helm unit under
`apps/opencrane/helm`.

Implementation lives with its capability:

- HTTP domains, identity/OIDC workflows, projection repair, and API specification live under `libs/backend/*/main`.
- the OpenClaw Tenant controller, renderers, workspace assets, and runtime lifecycle under
  `libs/backend/feat-openclaw-tenant/main` are deleted with the target controller/runtime slice;
- auth primitives, transport security, channel proxy, and hosting adapters live under
  `libs/server/_infra/{auth,http,channel-proxy,tenant-hosting}`.

## Bootstrap (`src/index.ts`)

Middleware order: transport-security → `express.json()` → `pino-http` → session → **`___AuthRouter` (public, mounted before auth)** → `___AuthMiddleware` → routes → error handler. DI: `___CreatePrismaClient` + `KubeConfig.loadFromDefault()` yielding `CustomObjectsApi` (CRDs), `CoreV1Api` (pod kill-switch), `AuthenticationV1Api` (TokenReview). `createApp(...)` is exported for tests.

The current boot path still starts OpenClaw, CRD projection, and in-process controller/proxy loops.
Treat those imports and lifecycle calls as a deletion map: target apps own controller, channel,
runtime, memory, index, artifact, and database deployment boundaries. Do not add behavior to the
current composite boot path except to remove it with its replacement.

## Current router inventory (`/api/v1`) and disposition

CRUD + notable actions:

- **tenants** and **policies** — current OpenClaw/CRD mutation, drift, and projection routes are
  deleted when AgentService and target authorization APIs land; do not preserve dual writes.
- **mcp-servers** — OBO credential brokering only.
- **skills** — ArtifactStore-backed SkillRevision publication authority.
- **groups**, **third-party-sources**, **provider-keys**, **access-tokens**, **audit**, **metrics** (`/projection-drift` + alert webhook), **token-usage**, **ai-budget** (LiteLLM spend, read-only), **org/workspace-docs** (company-doc versioning + 3-way merge proposals), **awareness/rollout** (`+ promote/rollback/resolve`), **awareness/participation**.

**Control-plane ownership:** ClusterTenant lifecycle, org membership, DNS, and Zitadel
administration are local target authorities. There is no external membership mirror.

**Internal (`/api/internal`, no `___AuthMiddleware`):** `contract/:name` (pod re-pull, TokenReview) and `awareness/participation` (TokenReview). Plus projection drift/repair helpers.

## Auth subsystem

- **OIDC** — `libs/backend/server/iam/identity/main`: PKCE login → session cookie (human operators). Email allow-list / domain allow-list optional.
- **pod connection preflight** — `POST /api/v1/auth/pod-token` is a direct-deletion endpoint; target
  channel/session resolution uses the target authorization and capability contracts.
- **`___AuthMiddleware` fallback chain** — OIDC and target access tokens survive only through the
  target authorization facade. Static-token and dev-bypass paths are deletion paths.
- **TokenReview** — internal endpoints validate projected tokens with `aud=opencrane-server`, parsing the tenant from `system:serviceaccount:<ns>:<name>`.

## Current authority residue and target grant compiler

Tenant/AccessPolicy CRD writes, projections, drift, and repair are deleted when target Postgres
authorities land. The target grant compiler preserves explicit priority and Deny-at-equal-priority,
with project as a dimension separate from department/team; it does not derive authority from a CRD
or dataset projection.

## Cognee Memory Wiring

The composed frozen runtime lifecycle provisions Cognee's dependencies, all best-effort/idempotent: a **dedicated LiteLLM virtual key** (`cognee-litellm-key.ts` — Cognee's LLM+embedding spend is a separate budget identity, never a tenant's), a per-silo **Cognee owner account + Cognee Tenant** (`cognee-silo-tenant.ts`), and — per openclaw Tenant, in the reconcile loop — a **real per-tenant Cognee login** keyed to the tenant's owner email (`cognee-tenant-identity.ts`), which is registered, joined to the silo Cognee Tenant, and `tenants/select`-ed so the plugin's `company` scope is genuinely shared silo-wide (not a private dataset per tenant). These files are under `libs/backend/feat-openclaw-tenant/main`. The tenant pod authenticates as itself via `COGNEE_USERNAME`/`COGNEE_PASSWORD` (never Cognee's `default_user` fallback).

**Embeddings** run through LiteLLM via the stable `auto-embedding` alias — the embedding-side mirror of the chat `auto` selection, registered by the BYOK bootstrap (`provision-byok-key.ts` `_ensureProviderEmbeddingModel`, `mode:"embedding"`, and deliberately **no `ModelDefinition` row** so it never surfaces as a tenant-selectable chat model). It only exists when a provider with a catalogued `embeddingModel` is set (`byok-default-models.ts` — today `openai` only). Cognee uses `EMBEDDING_PROVIDER=openai_compatible` (values.yaml `clustertenantManager.cognee.embedding`) so the model name reaches the proxy **verbatim**; the older `custom` value routed through Cognee's litellm engine, which strips the provider prefix and 400s. A fleet-level shared self-hosted embedding model is planned (issue #185).

## Prisma schema (`prisma/schema/`)

The current schema contains legacy Tenant, AccessPolicy, awareness, workspace, and projection state.
These are deletion targets. The first target persistence slice
uses a fresh target baseline for AgentService/Revision/Run,
Thread/Message/RunEvent, Approval, Persona, Artifact, SkillRevision, grants, audit, and membership
projection. CNPG applies it only while creating an empty database; startup never changes schema.

## Key Env

`PORT` (8080), `DATABASE_URL`, `NAMESPACE` (projection-repair scope), `WATCH_NAMESPACE`
(the TenantOperator's reconcile + workspace-seed scope), `MANAGE_TENANT_NAMESPACES` (default
true), `MANAGE_OWN_DOMAIN` (default true), `CLUSTER_TENANT_SEED_NAME`/`_DISPLAY_NAME`/
`_OWNER_EMAIL`/`_OWNER_SUBJECT`/`_TIER`, OIDC (`OIDC_ISSUER_URL`/`CLIENT_ID`/
`CLIENT_SECRET`/`REDIRECT_URI`/`SESSION_SECRET`/`ALLOWED_EMAIL(_DOMAINS)`),
`COGNEE_ENDPOINT`, `LITELLM_ENDPOINT`/`_MASTER_KEY`,
`OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS`,
`OPENCRANE_PROJECTION_DRIFT_ALERT_THRESHOLD`/`_DRIFT_WEBHOOK_URL`, and
`OPENCRANE_FORCE_HTTPS`. Artifact bytes are reached through the internal ArtifactStore service;
the server has no OCI-registry configuration.

## Deployment topology

The control plane always owns its ClusterTenant lifecycle. On boot it can self-seed its
cluster-scoped `ClusterTenant` CR, bind that CR to its namespace, own per-org namespace and
domain provisioning, and seed the `<org>-default` workspace from the immutable CR owner.

**Quickstart** — via the chart (`apps/_infra/deploy-k8s`):

```bash
helm dep build apps/_infra/deploy-k8s
helm install my-silo apps/_infra/deploy-k8s \
  -f apps/_infra/deploy-k8s/values/standalone.yaml \
  --set ingress.domain=example.com \
  --set clustertenantManager.standaloneSeed.ownerEmail=owner@example.com \
  --set clustertenantManager.database.existingSecret=my-db-secret
```

This leaves `crds.install`/`certManager.selfManagedIssuer` at their self-sufficient defaults and
self-seeds a `default` ClusterTenant owned by the given email on first boot. Cluster
prerequisites (ingress-nginx, cert-manager, a reachable Postgres) are not installed by this
chart — bring your own or run them via `apps/_infra/deploy-k8s/platform/k8s-deploy.sh` first.

To bootstrap a standalone ClusterTenant by hand instead of via `clustertenantManager.standaloneSeed`, apply a CR directly with `spec.owner.email` set — the seed is a convenience, not the only path:

```yaml
apiVersion: opencrane.io/v1alpha1
kind: ClusterTenant
metadata:
  name: default
spec:
  displayName: "Default Organisation"
  isolationTier: shared
  owner:
    email: owner@example.com
```

## Direct-deletion inventory

Delete retired registry skill delivery, DB/registry fallback, awareness rollout, the document-reconciliation
merge agent, OpenClaw controllers, projection repair, pod-token, and static-token escape with their
target replacements. Do not complete or stabilize these predecessor paths.
