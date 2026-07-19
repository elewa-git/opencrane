# @opencrane/backend/server/audit — Audit log

Mounted at: `/api/v1/audit`.

Owns the audit-trail read API. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/audit.prisma` where this domain owns models).
