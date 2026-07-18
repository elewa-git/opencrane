# OpenCrane — Future Work

Deliberately deferred scope. Items here are **decided to be out of scope for now**, not
backlog noise — each was punted with intent so the active roadmap (`plan.md`,
`silo-multi-tenant-plan.md`) stays focused. Promote an item back into `plan.md` when it's
time to do it.

## Isolation tiers — dedicated compute (deferred from S6 / ADR 0002)

S6 ([ADR 0002](docs/adr/0002-per-clustertenant-silo-architecture.md)) gives every ClusterTenant
a dedicated per-CT stack (Obot, feat-skill-registry, Cognee, LiteLLM, operator, networking, DB) **on
shared nodes**. The tiers that change the *underlying compute* are deferred:

- **`dedicatedNodes`** — pin a tenant's per-CT stack to its own node pool (taints/affinity).
  Pure scheduling change on top of the existing per-CT topology; no plane-architecture change.
- **`dedicatedCluster`** — a separate Kubernetes control plane per silo via **vcluster / Kamaji**,
  provisioned by an **arm's-length `ClusterTenantProvisioner` backend** (kept out-of-process as
  the **AGPL / WeOwnAI enterprise seam**, per ADR 0002).
- **Tier cost / footprint model (S7)** — map `ClusterTenant.spec.isolationTier`
  `shared → dedicatedNodes → dedicatedCluster` to a cost/footprint a customer can buy. Input =
  the per-CT bin-packing density on shared nodes (the S6 footprint).

Why deferred: shared nodes are sufficient for now; dedicated compute is a paid upgrade layered
on the same per-CT topology, so it doesn't block S6.

## Additional central components (beyond opencrane-ui + Zitadel)

Today the **only** central (shared, cross-silo) components are the **opencrane-ui** and
**Zitadel** (ADR 0002, decision 1). Future central components may be introduced as the platform
grows, e.g.:

- A **central skills catalog / registry** — a shared source catalog/marketplace, distinct from
  the per-CT feat-skill-registry *delivery* plane each tenant already runs. (Per-CT delivery stays;
  this would be an upstream shared catalog tenants pull from.)

Any new central component must justify why it is safe to share cross-silo (it sees no tenant
data, or only super-admin-scoped data) before leaving the per-CT default.

## Scope-aware retrieval plugin (S4e — deferred)

The Cognee retrieval precedence cascade (`DATASET_SCOPE_RETRIEVAL_PRECEDENCE`:
Personal → Project → Team → Department → Org) is **captured but not built**. Design + the
`node_set` ingestion tagging are in `plan.md` (P4B.7.2 / S4e); the runtime plugin that walks
scopes in precedence order is deferred.
