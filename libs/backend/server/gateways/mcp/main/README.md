# @opencrane/backend/server/gateways/mcp — MCP server registry + governance

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › mcp

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external tools and models agents may use. It owns the registry and governance of **MCP servers**.
MCP (the Model Context Protocol) is an open standard for connecting an agent to external tools and
data sources; an *MCP server* is one such tool provider. This package decides which MCP servers
exist, who may install them, and how their credentials are held.

It is the control plane in front of the tool runtime. Administrators curate and approve servers;
individual users browse the resulting directory, install the ones they are entitled to, and supply
credentials or complete an OAuth (delegated sign-in) connection. Only then does the runtime connect.

```
 admin / operator request     (register · approve · publish · set access policy)
        │                      user request  (browse directory · install · set credential · OAuth connect)
        ▼
 ┌────────────────────────────────────┐
 │  mcp  ◄── HERE                      │  server registry + approval state + per-user installs + credentials
 └────────────────────────────────────┘
        │  the servers a user is entitled to, with connection + credential status
        ▼
 agent runtime connects to those tool servers at run time
```

**In this flow:** [providers](../../providers/main/README.md) · [integrations](../../integrations/main/README.md) *(sibling tool/model gateways)* · agent runtime *(consumes entitlements)*

Invariant: a user only ever sees and installs servers permitted by the access policy and the
server's approval state (pending review → approved → published, or disabled). Credential values are
held for brokering but never echoed back on reads — the API returns connection status, not secrets.
Route handlers stay thin; the registry, entitlement filtering, and approval transitions live in the
service layer (`src/core/`), and the HTTP surface is generated into the OpenAPI (REST API description) paths.

## Public surface

- `mcpServersRouter`, `mcpOperatorRouter` — the two Express routers, mounted at `/api/v1/mcp-servers`
  and `/api/v1/mcp`.
- Operator services: `listEntitledCatalog`, `listInstalled`, `installServer`, `setCredential`,
  `connectOauth`, `approveServer`, `publishServer`, `getAccessPolicy`/`setAccessPolicy`, and more.
- Server-admin services: `listMcpServers`, `createMcpServer`, `updateMcpServer`, `deleteMcpServer`,
  and the credential CRUD (`addMcpServerCredential`, …).
- `_McpOpenapiPaths` — the OpenAPI path fragments for this surface.

## Boundary

The application layer supplies a `PrismaClient` and mounts the routers. This package does not open
tool connections itself or run agents — it governs *which* servers are available and *whether* a
user may use them. It fails closed: an unapproved server, or a user outside the access policy, never
appears in the directory.

## Dependency direction

Tagged `scope:mcp`: it may depend only on `scope:auth`, `scope:mcp`, and `scope:shared` — never on
apps or other server domains.

## Data & persistence

Owns `McpServer`, `McpServerInstall`, `McpServerAccessPolicy`, `McpServerAccessUser`,
and `McpServerCredential` in `apps/opencrane/prisma/schema/mcp.prisma`. The named
`PrismaMcpServerMutationUnitOfWork` is the only server-administration seam: it commits the parent,
credential metadata, and audit record together. It carries display names only, never credential values.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [integrations](../../integrations/main/README.md) · [providers](../../providers/main/README.md) · [model-routing](../../model-routing/main/README.md)
