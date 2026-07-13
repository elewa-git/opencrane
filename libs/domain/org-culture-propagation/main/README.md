# @opencrane/domain-org-culture-propagation — Org culture docs & propagation

Mounted at: `/api/v1/org/culture-docs`.

Owns culture doc versions, tenant culture-doc propagation proposals, L0 personalisation guard. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/domain/README.md`](../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/org-culture.prisma` where this domain owns models).
