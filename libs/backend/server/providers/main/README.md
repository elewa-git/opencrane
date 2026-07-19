# @opencrane/backend/server/providers — Provider credentials & model registry

Mounted at: `/api/v1/providers/*`, `/api/v1/models`.

Owns provider API keys, scoped credentials, BYOK provisioning, LiteLLM model registration. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/providers.prisma` where this domain owns models).
