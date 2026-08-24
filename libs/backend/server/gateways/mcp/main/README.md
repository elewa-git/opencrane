# @opencrane/backend/server/gateways/mcp — MCP governance

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › mcp

## What it owns

MCP (the Model Context Protocol) is an open standard for connecting an agent to external tools and
data sources. An *MCP server* provides those tools. This package decides which MCP servers exist,
which ones administrators approve, and who may install them.

A workflow is a background job whose progress is saved in the database. If OpenCrane restarts, the
job can continue instead of starting over. Absurd runs these jobs. This package uses workflows to
check a newly registered MCP server and a submitted signed MCP bundle.

```
 administrator sends POST /mcp/servers
        │
        ▼
 database transaction
   ├── save the draft MCP server
   └── save an Absurd background job
        │
        ▼
 worker checks the server's MCP protocol version
   ├── supported version ──► ready for administrator review
   ├── temporary failure ───► Absurd tries again later
   └── other or bad reply ──► rejected
```

```
 administrator sends POST /mcp/bundle-validations
        │
        ▼
 database transaction
   ├── save the exact published bundle revision
   └── save an Absurd background job
        │
        ▼
 worker checks the signed bundle and its manifest
   ├── trusted signature + valid manifest ──► verified
   └── invalid package ─────────────────────► rejected
```

The bundle check currently verifies the signature and the package manifest. Running the bundle in
an isolated environment, scanning it, building an image, and publishing it are later workflow
steps.

The draft server and its background job use one database transaction. Either both are saved, or
neither is saved. A repeated registration request returns the same draft and the same job.

Individual users browse the approved directory and install servers they may use. The API never
returns credentials and never labels an install connected before a real connection exists.

## Rules

- Only an organization administrator may register, review, approve, or publish a server.
- A server must pass the saved protocol check before it may be approved.
- Network failures, timeouts, rate limits, and server errors are retried. Unsafe addresses and bad
  replies are saved as rejected so the same task cannot keep contacting an unchanged endpoint. A
  temporary failure is tried at most five times, with a longer delay before each later check.
- A user only sees and installs servers allowed by saved access grants.
- The package reads saved users and groups. It does not treat raw login claims as access rights.
- Route handlers use the authenticated user's silo. They do not accept a silo from the request body.

## Public surface

- `mcpOperatorRouter` — the Express router mounted at `/api/v1/mcp`.
- `registerRemoteServer` — saves a draft server and its protocol-check job together.
- `__CreateMcpEraProbeWorkflow` — registers the saved background job that checks the server.
- `submitMcpbValidation` and `getMcpbValidation` — save and read signed MCP bundle checks.
- `__CreateMcpbValidationWorkflow` — registers the saved bundle verification job.
- Operator services: `listEntitledCatalog`, `listInstalled`, `installServer`, `approveServer`,
  `publishServer`, and the access editor.
- `_McpOpenapiPaths` — the OpenAPI path descriptions for this API.

## Boundary

The application supplies the database transaction and starts the Absurd worker. Routes never receive
a Prisma client. `PrismaMcpOperatorUnitOfWork` checks access, changes installs or server state, admits
background jobs, and records audit entries in one database transaction.

This package does not run agents or call tools. It governs which servers are available and whether a
user may use them. The external HTTP adapter performs the actual protocol check for the workflow.

## Dependency direction

Tagged `scope:mcp`: it may depend on the authentication guard, the shared authorization package, the
authenticated user directory, and the engine-neutral workflow contract. It never imports an app or
an Absurd package directly.

## Data and persistence

This package owns the public behavior around `McpServer`, `McpServerInstall`, and
`McpbValidation` in
`apps/opencrane/prisma/schema/mcp.prisma`. General `AuthorizationGrant` rows remain owned by the
authorization package. `PrismaMcpOperatorUnitOfWork` is the public MCP database boundary.

## See also

- Parent index: [gateways](../../README.md)
- Related packages: [integrations](../../integrations/main/README.md) · [providers](../../providers/main/README.md) · [model-routing](../../model-routing/main/README.md)
