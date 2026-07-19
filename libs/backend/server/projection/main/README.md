# @opencrane/backend/server/projection — CR projection repair

Mounted at: (no routes — consumed by tenants/policies/metrics).

Owns tenant/policy projection drift detection and repair. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/projection.prisma` where this domain owns models).
