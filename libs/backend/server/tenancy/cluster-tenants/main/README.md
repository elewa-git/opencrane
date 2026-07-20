# @opencrane/backend/server/cluster-tenants — ClusterTenant read-models

Mounted at: (no routes — middleware + seeding).

Owns ClusterTenant/OrgMembership read-models, own-cluster-tenant resolution, default-tenant seeding, the cluster-tenant scope middleware. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/cluster-tenants.prisma` where this domain owns models).
