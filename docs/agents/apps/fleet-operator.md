# App: fleet-operator (`@opencrane/fleet-operator`)

> Deep-dive for `apps/fleet-operator`. Index: [`../app-specific.md`](../app-specific.md). Cluster context:
> [`../cluster-architecture.md`](../cluster-architecture.md). Verified June 2026 (post fleet/silo split, v0.6.0).

The **cluster-wide hub + super-admin** — a single fleet-wide singleton (`@opencrane/fleet-operator`,
"fleet-manager") that owns ClusterTenant lifecycle for the whole fleet. It serves at the fleet
control-plane host (the platform host / apex), runs against its **own registry DB**, and combines a
**fleet HTTP API** (cross-silo super-admin surface) with **one reconcile loop**. Pure
`@kubernetes/client-node` + a custom watch runner — no controller-runtime framework.

It does **not** watch anything inside a silo — every per-org/in-silo controller (tenant runtime,
policies, plane drift-repair, rollout canary, Obot health, gateway proxy) runs in the per-silo
[`clustertenant-operator`](./clustertenant-operator.md). The fleet's only reconcile loop is the
**ClusterTenantOperator** below.

**Roles** (terminology per
[`cluster-architecture.md` → Tenancy Model](../cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant)):

1. **Owns ClusterTenant lifecycle (fleet API)** — the cross-silo super-admin surface served from its
   own registry DB: ClusterTenant CRUD + provisioner registry, org membership, billing, platform DNS,
   and Zitadel management (per-org OIDC client provisioning). See the Fleet API section below.
2. **Enforces ClusterTenant isolation (ClusterTenantOperator)** — for each **ClusterTenant** (the
   customer/isolation unit) it drives the cluster-scoped CR `pending`→`ready`: provisions/uses the
   bound namespace and stamps the PSA `baseline` label, `ResourceQuota`, `LimitRange`, and
   dedicated-node scheduling, plus the gated per-org domain.

## Boot (`src/index.ts`)

`main()` loads config, builds the K8s client, brings up the fleet HTTP API, then starts the one
reconcile loop; SIGTERM/SIGINT shut them down. In order: `___CreateFleetPrismaClient` (the registry
DB) → OIDC session middleware + `___FleetAuthRouter` (public login, before auth) → `___AuthMiddleware`
(OIDC session or env-var token; the registry has no `AccessToken` model) → `_RegisterFleetRoutes` →
error handler → `app.listen`. Then `_SeedClusterTenant` (single-tenant profile boot-seed, idempotent,
fail-soft) and finally `ClusterTenantOperator.start()`. The fleet watches **only** the cluster-scoped
`ClusterTenant` CR — nothing inside a silo.

## ClusterTenantOperator (`cluster-tenants/operator.ts`, idempotent)

The fleet's one reconcile loop: drives each cluster-scoped `ClusterTenant` CR (an org) `pending`→`ready`
via server-side apply, with per-org coalescing so a watch-reconnect replay can't pile up reconciles.
Per CR event:

1. **`provisioning`** — stamp the transitional phase.
2. **Resolve the isolation boundary** — the shared provisioner binds the `opencrane-<name>` namespace for in-cluster tiers; an unsupported tier → `failed`.
3. **Fence the bound namespace** — apply the namespace with the PSA `baseline` enforce/warn/audit labels (`_BuildClusterTenantNamespace`), idempotently. `baseline` (not `restricted`) because silos run 3rd-party planes — Obot's embedded root Postgres, Cognee-as-root, Langfuse subcharts — that can't meet `restricted`; `baseline` still blocks privileged containers, host namespaces, hostPath, and host ports.
4. **Provision the per-org domain** — `OrgDomainProvisioner.provisionOrgDomain(...)` applies the per-org wildcard `Certificate` and declares the A records as an external-dns `DNSEndpoint`; runtime-gated to a recorded skip condition when cert-manager or the DNSEndpoint CRD is absent, so a missing backend never fails reconcile.
5. **`ready`** — stamp `boundNamespace` + provisioner + domain status so `_ResolveClusterTenant` stops hard-failing and the silo can attach.

Re-running on an already-`ready` org converges to the same state.

## Fleet API (`routes.ts`, `/api/v1`)

The cross-silo super-admin surface, served from the fleet registry DB. Both feature blocks default ON
and are env-gated off (`OPENCRANE_CLUSTER_TENANT_MANAGER_ENABLED`, `OPENCRANE_BILLING_ENABLED`):

- **cluster-tenants** — ClusterTenant lifecycle CRUD: `GET /`, `GET /:name`, `GET /:name/status`, `POST /:name/refresh`, `POST /` (org create, billing-gated), `PUT /:name`, `DELETE /:name`. Wires the **provisioner registry** (gates `isolationTier` → `422 TIER_UNAVAILABLE`) and the Zitadel management client (per-org OIDC client provisioning). Most routes `requireOrgManager`.
- **cluster-tenants/:name/members** — the fleet's authoritative org membership registry (mergeParams under the parent org). Writes are Zitadel-seated transactionally (upsert grants the project role; DELETE revokes the IdP org membership FIRST — an IdP failure returns 502 and keeps the row so the reconcile backstop can't resurrect a half-removed member). Seat caps enforced on create via a row-locked in-tx reservation. The silo mirrors this set (projection repairer) and self-adopts on first login via the internal `/api/internal/cluster-tenants/:name/members/adopt` seam.
- **billing-accounts** — fleet-level seat ordering; the fleet notifies the silo of approved seats.
- **platform/dns** — platform-admin cert-manager DNS-01 issuer + creds Secret for the wildcard tenant cert.
- **admin/zitadel** — superadmin-gated rotation of the platform Zitadel SA key (the master IdP credential) + idempotent reconcile/backfill of half-provisioned orgs.
- **openapi.json** (public), **healthz** (DB health).

Zitadel is a hard dependency of the ClusterTenant path and is built **only** inside that gated block, so
an install without the cluster-tenant manager never requires Zitadel.

## Registry DB

The fleet runs its own Prisma/PostgreSQL registry (`infra/db/`) — distinct from each silo's projection
DB. It holds the fleet-owned models: `ClusterTenant`, org membership, and billing accounts. There is no
`AccessToken` model here, so the fleet API authenticates by OIDC session or the env-var token only.

## Watch Runner (`@opencrane/infra-api` `_RunWatchLoop`)

Generic loop with reconnect backoff. The K8s API closes watch streams every ~5–10 min; reconnect is
normal. Per-event handler errors are caught and logged, never crashing the loop.

## Key Env (`src/config.ts`)

`PORT` (8080), `DATABASE_URL` (the fleet registry), OIDC (`OIDC_*`/`SESSION_SECRET`/`ALLOWED_EMAIL(_DOMAINS)`), `OPENCRANE_API_TOKEN`, the feature gates `OPENCRANE_CLUSTER_TENANT_MANAGER_ENABLED` / `OPENCRANE_BILLING_ENABLED`, the per-org domain inputs (`PLATFORM_BASE_DOMAIN`, cert/DNS issuer config), and the single-tenant boot-seed env consumed by `_SeedClusterTenant`. Helm injects release-prefixed values — the in-code defaults are dev fallbacks only.
