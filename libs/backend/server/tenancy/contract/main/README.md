# @opencrane/backend/server/contract — Tenant runtime contract

Mounted at: `/api/internal/contract`.

Owns the effective-contract assembly served to tenant pods (grants + awareness + skill models + TOOLS.md rendering). Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/contract.prisma` where this domain owns models).
