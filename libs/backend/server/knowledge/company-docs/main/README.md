# @opencrane/backend/server/company-docs — Company docs & personalisation

Mounted at: `/api/v1/org/workspace-docs`.

Owns company doc versions, tenant doc reconciliation proposals, L0 personalisation guard. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/company-docs.prisma` where this domain owns models).
