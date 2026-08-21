# @opencrane/backend/server/gateways/mcp — MCP governance

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › mcp

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external tools and models agents may use. It owns the authenticated governance of **MCP servers**.
MCP (the Model Context Protocol) is an open standard for connecting an agent to external tools and
data sources; an *MCP server* is one such tool provider. This package decides which MCP servers
exist, who may install them, and how their credentials are held.

It is the control plane in front of server-owned tool execution. Administrators review and approve servers;
individual users browse the resulting directory, install the ones they are entitled to, and supply
credentials or complete an OAuth (delegated sign-in) connection. Only then may the server worker invoke a governed tool.

```
 admin / operator request     (review · approve · publish · author grants)
        │                      user request  (browse directory · install · set credential · OAuth connect)
        ▼
 ┌────────────────────────────────────┐
 │  mcp  ◄── HERE                      │  server registry + approval state + per-user installs + credentials
 └────────────────────────────────────┘
        │  the servers a user is entitled to, with connection + credential status
        ▼
 server worker invokes an allowed tool; the runtime receives only its saved result
```

**In this flow:** [providers](../../providers/main/README.md) · [integrations](../../integrations/main/README.md) *(sibling tool/model gateways)* · server action worker *(consumes entitlements)*

Invariant: a user only ever sees and installs servers permitted by generic authorization grants and
the server's approval state (pending review → approved → published, or disabled). The authorization
authority resolves local Principal and direct Group subjects from persisted membership; this package
never interprets OIDC group names as entitlement. Credential values are
held for brokering but never echoed back on reads — the API returns connection status, not secrets.
Route handlers stay thin; the registry, entitlement filtering, and approval transitions live in the
service layer (`src/core/`), and the HTTP surface is generated into the OpenAPI (REST API description) paths.

## Public surface

- `mcpOperatorRouter` — the Express router mounted at `/api/v1/mcp`.
- Operator services: `listEntitledCatalog`, `listInstalled`, `installServer`, `setCredential`,
  `connectOauth`, `approveServer`, `publishServer`, and the grant-backed access editor.
- `_McpOpenapiPaths` — the OpenAPI path fragments for this surface.

## Boundary

The application layer supplies the query and transaction ports and mounts the routers. Routes never
receive a Prisma client. `PrismaMcpOperatorUnitOfWork` resolves grants, applies access-editor
reconciliation, changes installs or governance state, and records audit evidence in one transaction.
There is no second unsiloed catalogue or credential-administration route: every public MCP operation
uses the authenticated local Principal and request silo through the operator unit of work. This package does not open
tool connections itself or run agents — it governs *which* servers are available and *whether* a
user may use them. It fails closed: an unapproved server, or a user outside the access policy, never
appears in the directory.

## Dependency direction

Tagged `scope:mcp`: it may depend on the narrow auth and generic authorization ports plus shared MCP
contracts — never on apps or another product domain's persistence adapter.

## Data & persistence

Owns the public governance behavior over `McpServer` and `McpServerInstall` in
`apps/opencrane/prisma/schema/mcp.prisma`. MCP entitlement rows remain generic
`AuthorizationGrant` records owned by the authorization domain. The named
The `PrismaMcpOperatorUnitOfWork` is the only public MCP persistence seam: it keeps catalogue state,
installs, generic grants, and audit evidence in one authenticated transaction. Credential values are
represented only by opaque custody references and never returned.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [integrations](../../integrations/main/README.md) · [providers](../../providers/main/README.md) · [model-routing](../../model-routing/main/README.md)
