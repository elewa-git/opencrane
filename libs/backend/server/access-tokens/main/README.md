# @opencrane/backend/server/access-tokens — Access tokens

Mounted at: `/api/v1/access-tokens`.

Owns personal access token management. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/access-tokens.prisma` where this domain owns models).
