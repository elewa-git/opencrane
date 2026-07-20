# @opencrane/backend/server/mcp — MCP servers

Mounted at: `/api/v1/mcp-servers`, `/api/v1/mcp`.

Owns MCP server registry + credentials, the operator-facing MCP directory/install/approval/OAuth surface. Routes live in `src/routes/`, services in `src/core/`, tests in
`src/__tests__/`; the public surface is the barrel (`src/index.ts`).

See [`libs/backend/README.md`](../../../README.md) for the layout, boundary rules and
how to add a peer package, and [`docs/agents/prisma.md`](../../../../../docs/agents/prisma.md)
for schema ownership (`prisma/schema/mcp.prisma` where this domain owns models).
