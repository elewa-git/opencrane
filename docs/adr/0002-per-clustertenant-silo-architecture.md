# ADR 0002 — Per-ClusterTenant silo architecture (dedicated operator, planes, API/DB per tenant)

- **Status:** Accepted
- **Date:** 2026-06-26
- **Task:** `task_5164276f` (Phase 3 / S6 of the strict-multi-tenancy program)
- **Supersedes / superseded by:** none — **refines** [ADR 0001](0001-cluster-tenant-virtual-network-isolation.md), which chose the isolation *substrate* (Linkerd + the NetworkPolicy floor) and explicitly deferred the *placement* decisions (which planes move into the silo, the per-CT operator design, per-CT API/DB) to Phase 3 / this ADR.
- **Related:** [`silo-multi-tenant-plan.md`](../../silo-multi-tenant-plan.md) (§ Phase 3) · [`plan.md`](../../plan.md) (S6) · `platform/helm/values.yaml` (`multiInstance`, `sharedPlatform`)

## Context

ADR 0001 settled the *boundary*: each ClusterTenant is a strictly isolated silo, with a
per-silo default-deny `NetworkPolicy` floor (S2) and Linkerd mTLS identity + L7 authorization
(S5) layered on top, and the super-admin opencrane-api as the only cross-silo principal.

But the *brains* are still communal. As-built, `opencrane-system` runs **shared singletons**
that serve every tenant:

| Concern | As-built | Problem it creates |
|---|---|---|
| Operator | one operator reconciles all tenants | a single failure domain; one operator writes every org's ingress |
| Planes (Obot/MCP, feat-skill-registry, LiteLLM, Cognee, tenant DB) | shared singletons | data/credentials co-resident; isolation rests entirely on app-level ACLs |
| Control-plane API + DB | one shared API + DB | the **resolution-ambiguity class**: the shared plane must constantly infer *which tenant* a request/row/resource belongs to — the root of a recurring family of bugs (default-tenant projection, cross-tenant lookups, the resolver patches), shimmed today by PR #68 |

This ADR decides **what runs per-ClusterTenant vs. stays central**. Every tenant gets its own
dedicated plane instances (decision 1); only the opencrane-api and Zitadel stay central. The
decision reuses the machinery the chart already has and preserves per-org ingress, and it
pushes the cost question to **bin-packing density** (S7), not to multiplexing tenants inside
one plane. **Isolation tiers are out of scope here and deferred** — for now every tenant's
dedicated stack runs on **shared nodes**; dedicated-nodes / dedicated-cluster tiers are
[`future-work.md`](../../future-work.md).

Two pieces of existing machinery are load-bearing here:

- **`multiInstance`** — the chart can already run N strictly-isolated OpenCrane instances in
  one cluster, each with a namespace-scoped operator (`requireWatchNamespace`).
- **`sharedPlatform.<plane>.mode = instance | shared`** — each plane (LiteLLM, feat-skill-registry,
  Obot) is *already* switchable between a release-local instance and a referenced shared
  endpoint.

S6 is largely **applying these per-ClusterTenant**, not inventing a new mechanism.

## Decision

### 1. Every ClusterTenant gets DEDICATED instances; only the opencrane-api and Zitadel stay central

Each ClusterTenant runs its **own dedicated instances** of the full per-tenant stack:

- **Obot / MCP gateway**
- **feat-skill-registry**
- **Cognee**
- **LiteLLM**
- its own **operator**
- its own **per-CT networking** (the S2 NetworkPolicy silo + S5 Linkerd identity)
- its own **tenant DB** (a dedicated Postgres database for the tenant)

Planes are **never shared singletons multiplexing tenants behind an ACL**. The **only central
(shared, cross-silo) components are the opencrane-api and Zitadel** — nothing else. (Other
central components may be introduced later — e.g. a central skills *catalog/registry* distinct
from per-CT delivery — but that is future work, not part of this decision; see
[`future-work.md`](../../future-work.md).)

This is realised with the machinery the chart already has: **every ClusterTenant is a
`multiInstance` instance** whose planes run in `sharedPlatform.<plane>.mode=instance`
(release-local, per-CT); the `mode=shared` path becomes vestigial (a special-case escape hatch,
not the default).

**For now, every tenant's dedicated stack runs on SHARED NODES** (bin-packed onto common
compute). Isolation tiers that change the *underlying compute* — `dedicatedNodes` (pinned node
pool) and `dedicatedCluster` (vcluster/Kamaji, separate control plane) — are **deferred to
[`future-work.md`](../../future-work.md)**; they change scheduling only, not the per-CT plane
topology decided here.

Rationale (corrects the first draft, which proposed shared-singleton planes + ACL): dedicated
per-CT instances give true per-tenant isolation of data/credentials/runtime **without**
depending on every plane's app-level ACL being perfect, and they **kill the
resolution-ambiguity class uniformly** (decision 3) — there is no shared tenant-facing plane
left to disambiguate. The cost trade-off moves to **bin-packing density** on shared nodes, not
to multiplexing tenants inside one plane.

### 2. The super-admin opencrane-api stays the *only* shared cross-silo plane

The fleet/provisioning/billing opencrane-api remains shared in `opencrane-system` (consistent
with ADR 0001: super-admin is the only cross-silo principal). It operates on **named**
ClusterTenants — provisioning org X, listing the fleet — which is **unambiguous by
construction** (no resolution needed; the CT name is the input). What moves out is the
*tenant-facing* data + API surface, so the shared plane never has to guess a caller's tenant.

### 3. Per-CT API + DB retires the resolution-ambiguity class — uniformly

Because every tier has a **dedicated per-CT tenant-facing API + DB instance** (decision 1),
the resolution-ambiguity class is killed **the same way at every tier**: the silo *is* the
scope, so the tenant-facing plane never infers a caller's tenant from request shape. The only
cross-silo plane left (the super-admin opencrane-api, decision 2) acts on **named** CTs, which
is unambiguous by construction. **PR #68's resolution shim is retired outright** — there is no
shared tenant-facing plane anywhere that needs to disambiguate. (This is strictly stronger than
the first draft's "logical partition + ACL at the `shared` tier".)

### 4. Per-CT operator owns its silo's north-south edge

Each ClusterTenant runs its **own** operator (the existing `multiInstance` +
`requireWatchNamespace` machinery, reparented under `ClusterTenantProvisioner`). **That**
operator owns its silo's `{org}.{base}` Ingress + `DNSEndpoint` + cert binding, scoped to its
namespace — never a shared operator writing every org's ingress. **Fail-closed:** a silo with
no ingress is *unreachable*, never cross-wired to another org's host. (The single shared
operator emitting every org's ingress is the pattern being retired, not preserved.)

### 5. Isolation tiers (dedicated nodes / dedicated cluster) are deferred

For now there is **one deployment shape**: per-CT stacks on **shared nodes**. Tiers that change
the underlying compute — `dedicatedNodes` and `dedicatedCluster` (vcluster/Kamaji, the
arm's-length AGPL/WeOwnAI provisioner seam) — and the cost/footprint model that selects them
are **out of scope for S6 and tracked in [`future-work.md`](../../future-work.md)**. They are
purely a *scheduling* change layered on top of the per-CT topology decided here, so deferring
them does not block this ADR.

## Implementation shape (post-acceptance; split into tasks)

1. **Provisioner reparent** — model **every** ClusterTenant as a `multiInstance` instance the
   `ClusterTenantProvisioner` stamps out (namespace + scoped operator + `mode=instance` planes
   incl. LiteLLM + per-CT DB), on shared nodes.
2. **Per-CT operator** — provision the namespace-scoped operator per CT; move per-org
   ingress/DNS ownership into it (fail-closed).
3. **Tenant API/DB split** — separate the central super-admin (cross-silo, named-CT) surface
   from the per-CT tenant-facing (silo-scoped) API + DB instance; delete the #68 resolution shim.

(Isolation-tier scheduling — dedicated nodes / vcluster — and the S7 cost model are
[`future-work.md`](../../future-work.md), not part of this split.)

## Alternatives considered

- **Shared-singleton planes + per-CT ACL at the `shared` tier** (this ADR's *first draft*) —
  one Obot/Cognee/etc. multiplexing all `shared`-tier tenants behind app-level ACL.
  **Rejected** on the correction in decision 1: it makes isolation depend on every plane's ACL
  being perfect, leaves data/credentials co-resident, and only *logically* partitions the
  resolution-ambiguity. Dedicated per-CT instances on shared infra cost more pods but isolate
  truly and kill the ambiguity outright.
- **Physically separating the compute now (dedicated nodes/cluster per tenant)** — **deferred**,
  not rejected: shared nodes are sufficient for now; dedicated compute is a later isolation-tier
  upgrade ([`future-work.md`](../../future-work.md)), layered on the same per-CT topology.
- **A brand-new per-CT deployment mechanism** — **rejected** in favor of reusing the existing
  `multiInstance` + `sharedPlatform.mode=instance` machinery; a parallel mechanism would
  duplicate the isolation surface and diverge.

## Consequences

- **Unblocks S8/S9/S10.** Obot OBO brokering (S8), Zot skill storage (S9), and
  provider-secret custody (S10) all target a **per-CT plane** now (uniform across tiers), so
  they no longer need a placement caveat — the plane is always the tenant's own.
- **Footprint is per-CT instance stacks bin-packed on shared nodes, not multiplexed.** Every
  tenant runs its own Obot + skills + Cognee + LiteLLM + operator + DB pods; the lever is
  **scheduling density on common nodes**, not fewer pods. This is more pods/tenant than
  singleton-multiplexing — the deliberate cost of true isolation. Right-sizing per-CT plane
  requests/limits is essential to keep density viable (and is the input to the future cost model).
- **N of everything** (N operators, plane stacks, DBs — N = tenant count) on shared nodes.
  Monitoring, upgrades, and resource governance must become **fleet-aware** from day one.
- **Fresh per-tenant provisioning.** The product creates each tenant directly in its own instance.
  No shared-singleton tenant state or data-transfer path is retained.
- **Isolation boundary stated honestly: *separate instances, shared nodes*** (+ S2/S5
  network/identity) — stronger than "one plane, many tenants, trust the ACL", and upgradeable
  later to dedicated nodes/cluster without changing the per-CT topology.
