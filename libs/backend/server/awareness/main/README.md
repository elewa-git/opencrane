# @opencrane/backend/server/awareness — Org-memory awareness

Mounted at: `/api/v1/awareness/*`, `/api/internal/awareness/participation`.

Owns awareness rollout waves, fleet participation reporting, participation events. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/awareness.prisma` where this domain owns models).
