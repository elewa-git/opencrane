# App: clustertenant-operator (`@opencrane/clustertenant-operator`)

> Deep-dive for `apps/clustertenant-operator`. Index: [`../app-specific.md`](../app-specific.md). Identity model:
> [`../architecture.md`](../architecture.md). Verified June 2026 (post fleet/silo split, v0.6.0).

The **per-silo control plane** — one instance per **ClusterTenant**, running in that org's own
namespace and served at the org host `<org>.<base>`. **Express 5 + Prisma (PostgreSQL) +
`@kubernetes/client-node`.** Source of truth for that silo's tenants, policies, grants, MCP servers,
and skills; OIDC broker + pod-token pairing; the only writer of **its silo's** Postgres projection.
Listens on `PORT` (default **8080**).

This is **not** the cross-silo hub — the cluster-wide [`fleet-operator`](./fleet-operator.md) owns
ClusterTenant lifecycle, platform DNS, and Zitadel management and serves at the fleet host / apex.
The silo serves the **UserTenant** endpoints (the per-user OpenClaw gateway, CRD kind `Tenant`) and
the org-scoped management surface below; it READS the cluster-scoped `ClusterTenant` CR only as a
**read-model** (to resolve a host's per-org login client). See
[`cluster-architecture.md` → Tenancy Model](../cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant).

## Layout

- `infra/` — cross-cutting: `auth/` (OIDC service, device-grant, pod-token pairing, brokered-device registry), `middleware/` (`___AuthMiddleware`, transport security), `db/` (Prisma client + healthcheck).
- `core/` — domain logic (non-HTTP): `grants/` (grant compiler + Cognee sync), `awareness/` (rollout, participation, metrics), `cluster-tenants/` (own `<org>-default` Tenant seed — read-model only, no provisioner registry; that's fleet), `connections/` (kill-switch/gateway-admin), `oci/` (Zot bundle store + backfill), `personalisation/`, `sessions/`, `scanning/`, `ai-budget/`.
- `features/` — higher-level workflows: `mcp-servers/`, `groups/`, `company-docs/`.
- `routes/` — HTTP handlers (each a `*.ts` + `*.types.ts` pair); `routes/internal/` are the auth-less, NetworkPolicy-gated endpoints.

## Bootstrap (`src/index.ts`)

Middleware order: transport-security → `express.json()` → `pino-http` → session → **`___AuthRouter` (public, mounted before auth)** → `___AuthMiddleware` → routes → error handler. DI: `___CreatePrismaClient` + `KubeConfig.loadFromDefault()` yielding `CustomObjectsApi` (CRDs), `CoreV1Api` (pod kill-switch), `AuthenticationV1Api` (TokenReview). `createApp(...)` is exported for tests.

On boot the silo also **starts the in-silo controllers over its own namespace** (`config.watchNamespace`) — the fleet watches nothing inside a silo, so each silo reconciles itself: `TenantOperator` (openclaw pods/ConfigMaps/Services + LiteLLM keys), `PolicyOperator` (AccessPolicy → NetworkPolicy), `IdleChecker`, `RuntimePlaneDriftRepairer`, the opt-in rollout canary controller, `ObotHealthChecker`, and the in-process identity-routing gateway proxy. It also **seeds its own `<org>-default` Tenant** (`_SeedOwnDefaultTenant`, discovering its org via `_ResolveOwnClusterTenant` — the CR whose `status.boundNamespace` is this namespace) and runs two periodic repairers: `TenantProjectionRepairer` (CRD→DB backstop) and `MembershipProjectionRepairer` (fleet→silo `OrgMembership` mirror; prunes rows the fleet lacks). Auth-side, the OIDC `onLoginEstablished` hook adopts a verified member into their org on first login (`_AdoptMemberOnLogin` — write-through to the fleet SoR when `FLEET_INTERNAL_URL` is set, local upsert standalone), seeds their subject-bound workspace, and mirrors `group:*` role claims into `Group.members` (`_MirrorGroupsOnLogin`). Controller bootstrap is fail-soft — a failure leaves the management API up but the tenant runtime not reconciling.

## Router Inventory (`/api/v1`)

CRUD + notable actions:

- **tenants** (UserTenants — per-user OpenClaw gateways) — `+ suspend/resume`, `/drift`, `/repair`, `/datasets`, **`/effective-contract`** (compiled grants + rendered tools). Dual-writes CRD ↔ Postgres.
- **policies** — `+ drift/repair`; best-effort Cognee propagation. Dual-writes CRD ↔ Postgres.
- **mcp-servers** — `+ credentials` (static-fallback vs per-user OBO brokering).
- **skills/catalog** — `+ /:id/scan`, promote-gate (publish only if scan passed), `/backfill` (DB→OCI dual-write).
- **groups**, **third-party-sources**, **provider-keys**, **access-tokens** (CLI tokens), **audit**, **metrics** (`/projection-drift` + alert webhook), **token-usage**, **ai-budget** (LiteLLM spend, read-only), **org/workspace-docs** (company-doc versioning + 3-way merge proposals), **awareness/rollout** (`+ promote/rollback/resolve`), **awareness/participation**, **sessions** (scope binding).

**Not served here (fleet-only since the split):** `cluster-tenants` lifecycle CRUD + provisioning, org membership, billing, `platform/dns`, and Zitadel administration moved to the [`fleet-operator`](./fleet-operator.md). The silo keeps `ClusterTenant` + `OrgMembership` as local **read-models** (per-org login + the org-admin gate) but does not mount their management routers.

**Internal (`/api/internal`, no `___AuthMiddleware`):** `obot-registry` (Obot polls), `bundles/:digest/content` (skill-registry proxies, entitlement-gated), `contract/:name` (pod re-pull, TokenReview), `awareness/participation` (TokenReview). Plus projection drift/repair helpers.

## Auth Subsystem (`infra/auth/`)

- **OIDC** — PKCE login → session cookie (human operators). Email allow-list / domain allow-list optional.
- **Device flow** — `POST /auth/device` → browser activate → poll `/auth/device/token` → mints a DB `AccessToken` (this is what `oc auth login` uses).
- **pod-token pairing broker** — `POST /api/v1/auth/pod-token` resolves the tenant **solely from the verified session email** (fail-closed `409 AMBIGUOUS_TENANT`), returns `{ gatewayUrl, bootstrapToken, tenant, ingressHost }`, and records a `BrokeredDevice` for per-user kill-switch. `/pod-token/cut` revokes the caller's connections without touching the shared pod.
- **`___AuthMiddleware` fallback chain** — public paths → OIDC session → `OPENCRANE_API_TOKEN` env → DB access token → dev bypass. **No per-route role enforcement yet** (roles are a planned target).
- **TokenReview** — internal endpoints validate projected tokens with `aud=control-plane`, parsing the tenant from `system:serviceaccount:<ns>:<name>`.

## Dual-Write & Grant Compiler

Tenant/AccessPolicy mutations write both the CRD (operator's source of truth) and the Postgres row (API/UI projection). Drift is expected; `/drift` detects and `/repair` (dry-run by default) fixes CRD→DB. The **grant compiler** (`core/grants/`) resolves `(principal, payloadType ∈ Awareness|McpServer|SkillBundle)` over group membership with precedence `priority` > Deny-over-Allow > newest. It powers `effective-contract`, internal bundle gating (404 existence-hiding), and session-scope intersection.

## Prisma Schema (`prisma/schema.prisma`)

PostgreSQL. ~30 models incl. `Tenant`, `ClusterTenant`, `AccessPolicy`, `Group`, `Grant`/`McpServerGrant`/`SkillEntitlement`, `McpServer`/`McpServerCredential`, `SkillBundle`/`SkillPromotion`, `ThirdPartySource(+Item)`, `BrokeredDevice`, `AccessToken`, `ProviderApiKey`, `AuditEntry`, `SessionScope`, `AwarenessRollout`, `ParticipationEvent`/`TenantParticipation`, `CompanyDoc(+Version)`/`TenantWorkspaceDoc`/`DocMergeProposal`, `OrgDocument`/`HarvestingCursor`, `TenantDatasetMembership`, budget/usage snapshots. Enums mirror `@opencrane/contracts` (GrantAccess/Scope/SubjectType, McpServer*, SkillBundle*, ClusterTenant*, etc.).

## Key Env

`PORT` (8080), `DATABASE_URL`, `NAMESPACE` (projection-repair scope), `WATCH_NAMESPACE` (the TenantOperator's reconcile + workspace-seed scope), `MANAGE_TENANT_NAMESPACES` (default false — fleet-manager owns per-org namespace creation; true only for a standalone silo with the gated ns-manage ClusterRole), `FLEET_INTERNAL_URL` (fleet internal API base for the membership mirror + login write-through; unset = standalone membership ownership), `OPENCRANE_API_TOKEN`, OIDC (`OIDC_ISSUER_URL`/`CLIENT_ID`/`CLIENT_SECRET`/`REDIRECT_URI`/`SESSION_SECRET`/`ALLOWED_EMAIL(_DOMAINS)`), `SKILL_OCI_REGISTRY_URL`/`SKILL_OCI_REPOSITORY`, `COGNEE_ENDPOINT`, `LITELLM_ENDPOINT`/`_MASTER_KEY`, `OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS`, `OPENCRANE_PROJECTION_DRIFT_ALERT_THRESHOLD`/`_DRIFT_WEBHOOK_URL`, `OPENCRANE_FORCE_HTTPS`.

## In-flight

OCI/Zot skill delivery is mid-cutover (dual-write DB + registry; resolve OCI-first, DB fallback). Awareness rollout `shadowMode` and the doc-reconciliation merge agent are partly scaffolded. AI-budget enforcement lives in LiteLLM; the control-plane only reads spend.
