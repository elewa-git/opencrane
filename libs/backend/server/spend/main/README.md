# @opencrane/backend/server/spend — Spend & AI budgets

Mounted at: `/api/v1/spend`, `/api/v1/token-usage`, `/api/v1/ai-budget`.

Owns spend aggregation, token-usage snapshots, global/account budgets, LiteLLM virtual keys. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/spend.prisma` where this domain owns models).
