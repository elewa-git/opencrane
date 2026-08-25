# @opencrane/backend/server/gateways/mcp — MCP governance

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › mcp

## What it owns

This package is part of the **gateway-governance plane** — the side of OpenCrane that governs the
external tools and models agents may use. It owns the authenticated governance of **MCP servers**.
MCP (the Model Context Protocol) is an open standard for connecting an agent to external tools and
data sources; an *MCP server* is one such tool provider. This package decides which MCP servers
exist and who may install them. Credential and OAuth activation remain unavailable until the
application composes a verified Obot custody exchange.

It is the control plane in front of server-owned tool execution. Administrators review and approve servers;
individual users browse the resulting directory and install the ones they are entitled to. Credential
and OAuth activation routes are absent; the product never fabricates a local connection handle.

```
 admin / operator request     (review · approve · publish · author grants)
        │                      user request  (browse directory · install)
        ▼
 ┌────────────────────────────────────┐
 │  mcp  ◄── HERE                      │  server registry + approval state + per-user installs
 └────────────────────────────────────┘
        │  the servers a user is entitled to, with truthful connection status
        ▼
 server worker invokes an allowed tool; the runtime receives only its saved result
```

**In this flow:** [providers](../../providers/main/README.md) · [integrations](../../integrations/main/README.md) *(sibling tool/model gateways)* · server action worker *(consumes entitlements)*

Invariant: a user only ever sees and installs servers permitted by generic authorization grants and
the server's approval state (pending review → approved → published, or disabled). The authorization
authority resolves local Principal and direct Group subjects from persisted membership; this package
never interprets OIDC group names as entitlement. No credential-bearing endpoint exists while custody
is unavailable, and the API never labels such an install connected.
Route handlers stay thin; the registry, entitlement filtering, and approval transitions live in the
service layer (`src/core/`), and the HTTP surface is generated into the OpenAPI (REST API description) paths.

## Public surface

- `mcpOperatorRouter` — the Express router mounted at `/api/v1/mcp`.
- Operator services: `listEntitledCatalog`, `listInstalled`, `installServer`, `approveServer`,
  `publishServer`, and the grant-backed access editor.
- `_McpOpenapiPaths` — the OpenAPI path fragments for this surface.

## Boundary

The application layer supplies the query and transaction ports and mounts the routers. Routes never
receive a Prisma client. `PrismaMcpOperatorUnitOfWork` resolves grants, applies access-editor
reconciliation, changes installs or governance state, and records audit evidence in one transaction.
There is no second unsiloed catalogue: every public MCP operation
uses the authenticated local Principal and request silo through the operator unit of work. This package does not open
tool connections itself or run agents — it governs *which* servers are available and *whether* a
user may use them. It fails closed: an unapproved server, or a user outside the access policy, never
appears in the directory.

## Dependency direction

Tagged `scope:mcp`: it may depend on the authentication guard, the generic authorization authority,
and the authenticated Principal directory port plus shared MCP contracts. It never imports an app or
another product domain's persistence adapter.

## Data & persistence

Owns the public governance behavior over `McpServer` and `McpServerInstall` in
`apps/opencrane/prisma/schema/mcp.prisma`. MCP entitlement rows are generic `AuthorizationGrant`
records owned by the authorization domain. The `PrismaMcpOperatorUnitOfWork` is the only public MCP
persistence seam: it keeps catalogue state, installs, generic grants, and audit evidence in one
authenticated transaction. Installation never starts a connection flow; connecting happens through
the gateway plane after an operator approves the server.

## See also

- Parent index: [gateways](../../README.md)
- Siblings: [integrations](../../integrations/main/README.md) · [providers](../../providers/main/README.md) · [model-routing](../../model-routing/main/README.md)
