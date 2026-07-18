# App: opencrane (`@opencrane/server`)

> Deep-dive for `apps/opencrane`. Index: [`../app-specific.md`](../app-specific.md). Identity model:
> [`../architecture.md`](../architecture.md). Verified June 2026 (post fleet/silo split, v0.6.0).

The **per-silo control plane** — one instance per **ClusterTenant**, running in that org's own
namespace and served at the org host `<org>.<base>`. **Express 5 + Prisma (PostgreSQL) +
`@kubernetes/client-node`.** Source of truth for that silo's tenants, policies, grants, MCP servers,
and skills; OIDC broker + temporary pod connection preflight; the only writer of **its silo's** Postgres projection.
Listens on `PORT` (default **8080**).

This is **not** the cross-silo hub — the cluster-wide [`fleet-operator`](./fleet-operator.md) owns
ClusterTenant lifecycle, platform DNS, and Zitadel management and serves at the fleet host / apex.
The silo serves the **UserTenant** endpoints (the per-user OpenClaw gateway, CRD kind `Tenant`) and
the org-scoped management surface below; it READS the cluster-scoped `ClusterTenant` CR only as a
**read-model** (to resolve a host's per-org login client). See
[`cluster-architecture.md` → Tenancy Model](../cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant).

## Layout

- `infra/` — cross-cutting: `auth/` (OIDC service and pod connection preflight), `middleware/` (`___AuthMiddleware`, transport security), `db/` (Prisma client + healthcheck).
- `core/` — domain logic (non-HTTP): `grants/` (grant compiler + Cognee sync), `awareness/` (rollout, participation, metrics), `cluster-tenants/` (own `<org>-default` Tenant seed — read-model only, no provisioner registry; that's fleet), `connections/` (full-tenant pod cut), `oci/` (Zot bundle store + backfill), `personalisation/`, `scanning/`, `ai-budget/`.
- `features/` — higher-level workflows: `mcp-servers/`, `groups/`, `company-docs/`.
- `routes/` — HTTP handlers (each a `*.ts` + `*.types.ts` pair); `routes/internal/` are the auth-less, NetworkPolicy-gated endpoints.

## Bootstrap (`src/index.ts`)

Middleware order: transport-security → `express.json()` → `pino-http` → session → **`___AuthRouter` (public, mounted before auth)** → `___AuthMiddleware` → routes → error handler. DI: `___CreatePrismaClient` + `KubeConfig.loadFromDefault()` yielding `CustomObjectsApi` (CRDs), `CoreV1Api` (pod kill-switch), `AuthenticationV1Api` (TokenReview). `createApp(...)` is exported for tests.

On boot the silo also **starts the in-silo controllers over its own namespace** (`config.watchNamespace`) — the fleet watches nothing inside a silo, so each silo reconciles itself: `TenantOperator` (openclaw pods/ConfigMaps/Services + LiteLLM keys), `PolicyOperator` (AccessPolicy → NetworkPolicy), `IdleChecker`, `RuntimePlaneDriftRepairer`, and the in-process identity-routing gateway proxy. It also **seeds its own `<org>-default` Tenant** (`_SeedOwnDefaultTenant`, discovering its org via `_ResolveOwnClusterTenant` — the CR whose `status.boundNamespace` is this namespace) and runs two periodic repairers: `TenantProjectionRepairer` (CRD→DB backstop) and `MembershipProjectionRepairer` (fleet→silo `OrgMembership` mirror; prunes rows the fleet lacks). Auth-side, the OIDC `onLoginEstablished` hook adopts a verified member into their org on first login (`_AdoptMemberOnLogin` — write-through to the fleet SoR when `FLEET_INTERNAL_URL` is set, local upsert standalone), seeds their subject-bound workspace, and mirrors `group:*` role claims into `Group.members` (`_MirrorGroupsOnLogin`). Controller bootstrap is fail-soft — a failure leaves the management API up but the tenant runtime not reconciling.

## Router Inventory (`/api/v1`)

CRUD + notable actions:

- **tenants** (UserTenants — per-user OpenClaw gateways) — `+ suspend/resume`, `/drift`, `/repair`, `/datasets`, **`/effective-contract`** (compiled grants + rendered tools). Dual-writes CRD ↔ Postgres.
- **policies** — `+ drift/repair`; best-effort Cognee propagation. Dual-writes CRD ↔ Postgres.
- **mcp-servers** — `+ credentials` (static-fallback vs per-user OBO brokering).
- **skills/catalog** — `+ /:id/scan`, promote-gate (publish only if scan passed), `/backfill` (DB→OCI dual-write).
- **groups**, **third-party-sources**, **provider-keys**, **access-tokens**, **audit**, **metrics** (`/projection-drift` + alert webhook), **token-usage**, **ai-budget** (LiteLLM spend, read-only), **org/workspace-docs** (company-doc versioning + 3-way merge proposals), **awareness/rollout** (`+ promote/rollback/resolve`), **awareness/participation**.

**Not served here (fleet-only since the split):** `cluster-tenants` lifecycle CRUD + provisioning, org membership, billing, `platform/dns`, and Zitadel administration moved to the [`fleet-operator`](./fleet-operator.md). The silo keeps `ClusterTenant` + `OrgMembership` as local **read-models** (per-org login + the org-admin gate) but does not mount their management routers.

**Internal (`/api/internal`, no `___AuthMiddleware`):** `bundles/:digest/content` (feat-skill-registry proxies, entitlement-gated), `contract/:name` (pod re-pull, TokenReview), and `awareness/participation` (TokenReview). Plus projection drift/repair helpers.

## Auth Subsystem (`infra/auth/`)

- **OIDC** — PKCE login → session cookie (human operators). Email allow-list / domain allow-list optional.
- **pod connection preflight** — `POST /api/v1/auth/pod-token` resolves the tenant **solely from the verified session email** (fail-closed `409 AMBIGUOUS_TENANT`) and returns `{ gatewayUrl, tenant, ingressHost }`. It returns no pod/gateway token, records no device, and expires at that silo's R9 cutover.
- **`___AuthMiddleware` fallback chain** — public paths → OIDC session → `OPENCRANE_API_TOKEN` env → DB access token → dev bypass. **No per-route role enforcement yet** (roles are a planned target).
- **TokenReview** — internal endpoints validate projected tokens with `aud=opencrane-server`, parsing the tenant from `system:serviceaccount:<ns>:<name>`.

## Dual-Write & Grant Compiler

Tenant/AccessPolicy mutations write both the CRD (operator's source of truth) and the Postgres row (API/UI projection). Drift is expected; `/drift` detects and `/repair` (dry-run by default) fixes CRD→DB. The **grant compiler** (`core/grants/`) resolves `(principal, payloadType ∈ Awareness|McpServer|SkillBundle)` over group membership with precedence `priority` > Deny-over-Allow > newest. It powers `effective-contract` and internal bundle gating (404 existence-hiding).

## Cognee Memory Wiring

Boot-time (the `index.ts` in-silo IIFE) provisions Cognee's dependencies, all best-effort/idempotent: a **dedicated LiteLLM virtual key** (`cognee-litellm-key.ts` — Cognee's LLM+embedding spend is a separate budget identity, never a tenant's), a per-silo **Cognee owner account + Cognee Tenant** (`cognee-silo-tenant.ts`), and — per openclaw Tenant, in the reconcile loop — a **real per-tenant Cognee login** keyed to the tenant's owner email (`cognee-tenant-identity.ts`), which is registered, joined to the silo Cognee Tenant, and `tenants/select`-ed so the plugin's `company` scope is genuinely shared silo-wide (not a private dataset per tenant). The tenant pod authenticates as itself via `COGNEE_USERNAME`/`COGNEE_PASSWORD` (never Cognee's `default_user` fallback).

**Embeddings** run through LiteLLM via the stable `auto-embedding` alias — the embedding-side mirror of the chat `auto` selection, registered by the BYOK bootstrap (`provision-byok-key.ts` `_ensureProviderEmbeddingModel`, `mode:"embedding"`, and deliberately **no `ModelDefinition` row** so it never surfaces as a tenant-selectable chat model). It only exists when a provider with a catalogued `embeddingModel` is set (`byok-default-models.ts` — today `openai` only). Cognee uses `EMBEDDING_PROVIDER=openai_compatible` (values.yaml `clustertenantManager.cognee.embedding`) so the model name reaches the proxy **verbatim**; the older `custom` value routed through Cognee's litellm engine, which strips the provider prefix and 400s. A fleet-level shared self-hosted embedding model is planned (issue #185).

## Prisma Schema (`prisma/schema.prisma`)

PostgreSQL. Models include `Tenant`, `ClusterTenant`, `AccessPolicy`, `Group`, `Grant`/`McpServerGrant`/`SkillEntitlement`, `McpServer`/`McpServerCredential`, `SkillBundle`/`SkillPromotion`, `ThirdPartySource(+Item)`, `AccessToken`, `ProviderApiKey`, `AuditEntry`, `AwarenessRollout`, `ParticipationEvent`/`TenantParticipation`, `CompanyDoc(+Version)`/`TenantWorkspaceDoc`/`DocMergeProposal`, `OrgDocument`/`HarvestingCursor`, `TenantDatasetMembership`, and budget/usage snapshots. The retained `SessionScope` table is read-only migration evidence until R0/R3 disposition; it is not a live API or security control. Enums mirror `@opencrane/contracts` (GrantAccess/Scope/SubjectType, McpServer*, SkillBundle*, ClusterTenant*, etc.).

## Key Env

`PORT` (8080), `DATABASE_URL`, `NAMESPACE` (projection-repair scope), `WATCH_NAMESPACE` (the TenantOperator's reconcile + workspace-seed scope), `DEPLOYMENT_MODE` (`standalone` | `fleet-managed` — see "Deployment modes" below), `MANAGE_TENANT_NAMESPACES` (default false — fleet-manager owns per-org namespace creation; true only for a standalone silo with the gated ns-manage ClusterRole), `MANAGE_OWN_DOMAIN` (defaults from `DEPLOYMENT_MODE`), `FLEET_INTERNAL_URL` (fleet internal API base for the membership mirror + login write-through; unset = standalone membership ownership), `CLUSTER_TENANT_SEED_NAME`/`_DISPLAY_NAME`/`_OWNER_EMAIL`/`_OWNER_SUBJECT`/`_TIER` (standalone-only ClusterTenant self-seed), `OPENCRANE_API_TOKEN`, OIDC (`OIDC_ISSUER_URL`/`CLIENT_ID`/`CLIENT_SECRET`/`REDIRECT_URI`/`SESSION_SECRET`/`ALLOWED_EMAIL(_DOMAINS)`), `SKILL_OCI_REGISTRY_URL`/`SKILL_OCI_REPOSITORY`, `COGNEE_ENDPOINT`, `LITELLM_ENDPOINT`/`_MASTER_KEY`, `OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS`, `OPENCRANE_PROJECTION_DRIFT_ALERT_THRESHOLD`/`_DRIFT_WEBHOOK_URL`, `OPENCRANE_FORCE_HTTPS`.

## Deployment modes (#151 item 4)

A silo runs in exactly one of two topologies, resolved to a single `DEPLOYMENT_MODE` value (`config.ts`'s `deploymentMode`) that every other standalone-vs-fleet-managed default in this app derives from:

- **`fleet-managed`** — an external fleet-manager (the WeOwnAI control plane, italanta/opencrane#150) owns `ClusterTenant` lifecycle: it creates the CR, seeds `spec.owner`, creates/owns the org namespace, and this silo's `MembershipProjectionRepairer` mirrors membership from `FLEET_INTERNAL_URL`. The silo never creates or binds a `ClusterTenant` itself in this mode.
- **`standalone`** — no fleet anywhere. This silo is the sole authority: it self-seeds its own cluster-scoped `ClusterTenant` CR on boot (`_SeedOwnClusterTenant`, gated on `deploymentMode === "standalone"` in `index.ts`), binds it to its own namespace, owns per-org namespace creation (`MANAGE_TENANT_NAMESPACES`) and domain provisioning (`MANAGE_OWN_DOMAIN`), and then seeds its own `<org>-default` workspace Tenant from that CR's owner (`_SeedOwnDefaultTenant`) — both boot seeds are best-effort/idempotent and run only in this mode (see the `if (config.deploymentMode === "standalone")` gate in `index.ts`, `~line 290`).

`DEPLOYMENT_MODE` wins when set; otherwise the SAME fallback the chart itself uses applies: an empty `FLEET_INTERNAL_URL` derives `standalone`, a non-empty one derives `fleet-managed` — so a deployment that sets neither env var behaves exactly as it did before this switch existed.

**Standalone quickstart** — via the chart (`apps/opencrane-infra`), no fleet checkout needed:

```bash
helm dep build apps/opencrane-infra
helm install my-silo apps/opencrane-infra \
  -f apps/opencrane-infra/values/standalone.yaml \
  --set ingress.domain=example.com \
  --set clustertenantManager.standaloneSeed.ownerEmail=owner@example.com \
  --set clustertenantManager.database.existingSecret=my-db-secret
```

This sets `deploymentMode: standalone` (which fans out `manageTenantNamespaces`/`manageOwnDomain`/`DEPLOYMENT_MODE` coherently), leaves `crds.install`/`certManager.selfManagedIssuer` at their self-sufficient defaults (#151 items 2/3), and self-seeds a `default` ClusterTenant owned by the given email on first boot. Cluster prerequisites (ingress-nginx, cert-manager, a reachable Postgres) are NOT installed by this chart — bring your own or run them via `libs/k8s-platform/k8s-deploy.sh` first. A `helm` `fail` guard (and a `values.schema.json` check, one step earlier) rejects a contradictory combination — `deploymentMode: fleet-managed` with an empty `fleetInternalUrl`, or `deploymentMode: standalone` with a non-empty one.

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

## In-flight

OCI/Zot skill delivery is mid-cutover (dual-write DB + registry; resolve OCI-first, DB fallback). Awareness rollout `shadowMode` and the doc-reconciliation merge agent are partly scaffolded. AI-budget enforcement lives in LiteLLM; opencrane-server only reads spend.
