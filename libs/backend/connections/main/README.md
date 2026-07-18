# @opencrane/backend-connections — Gateway connections

Mounted at: (no routes — consumed by tenants/auth).

Owns tenant runtime cut-off, identity-to-gateway resolution, membership suspension checks, and
org namespace helpers. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`). This domain owns no Prisma
model after the legacy connection registry deletion.

See [`libs/backend/README.md`](../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../docs/agents/prisma.md)
for schema ownership rules.
