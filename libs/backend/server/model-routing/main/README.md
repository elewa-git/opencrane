# @opencrane/backend/server/model-routing — Model routing

Mounted at: `/api/v1/model-routing/*`, `/api/internal/tenant-models`.

Owns routing defaults, eval cases, shadow measurements, proposals, recommendations, metrics, per-tenant model allowlists. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/model-routing.prisma` where this domain owns models).
