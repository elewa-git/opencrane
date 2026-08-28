# @opencrane/backend/server/gateways/mcp — MCP governance

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › mcp

## What it owns

MCP (the Model Context Protocol) is an open standard for connecting an agent to external tools and
data sources. An *MCP server* provides those tools. This package decides which MCP servers exist,
which ones administrators approve, and who may install them.

A workflow is a background job whose progress is saved in the database. If OpenCrane restarts, the
job can continue instead of starting over. Absurd runs these jobs. This package uses workflows to
check a newly registered MCP server and a submitted OCI Image Layout ZIP.

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
 administrator sends POST /mcp/oci-image-validations
        │
        ▼
 database transaction
   ├── save the exact published OCI image revision
   └── save an Absurd background job
        │
        ▼
 worker validates the OCI layout, descriptors, and content digests
   ├── invalid archive or layout ────► rejected
   └── valid immutable OCI layout
            │
            ▼
       copy config, layers, and manifest to the operator registry
            │
            ▼
       save registry/repository@sha256:... ──► imported and stored for a later governed runtime claim
```

Layout validation checks the OCI Image Layout structure and every content-addressed descriptor. A
successful admission also copies the exact image into the operator registry and saves its immutable
digest-pinned reference. It does not treat a valid layout as evidence that the image is an MCP v2
server: that evidence must come from the actual `server/discover` exchange after a governed runtime
starts the imported image.

An installed server can then run a tool through a public task. The task keeps its state, input,
result, and failure in the database, so a server restart does not repeat the tool call.

```
 caller sends POST /mcp/tasks with one server revision and tool revision
        │
        ▼
 database transaction
   ├── save the MCP task
   └── save its Absurd workflow job
        │
        ├── input needed ──► save the question ──► wait for POST /tasks/{id}/input
        │
        ▼
 save one ToolInvocation owned by this task
        │
        ▼
existing OCI MCP executor runs the immutable image
   ├── checked result ─────► task completed
   ├── definite failure ───► task failed
   ├── retries used up before the call starts ──► task failed; queued work closed
   ├── retries used up after the call starts ───► recovery required; claimed work closed under its saved fence
   └── uncertain outcome ──► recovery required; never run it again automatically
        │
        ▼
 terminal execution ──► controller deletes the exact saved Kubernetes Job UID
                    └──► database records cleanup; outages are retried
```

The draft server and its background job use one database transaction. Either both are saved, or
neither is saved. A repeated registration request returns the same draft and the same job.

Cancellation is also tied to the saved runtime claim. If the controller has taken a claim but has
not yet saved the Kubernetes Job UID, the task stays pending until that exact UID is saved. The
terminal cleanup claim can then delete the right Job. If provider execution has already started,
the cancellation request is refused instead of pretending that the tool call did not run.

Individual users browse the approved directory and install servers they may use. For OCI-backed
servers, the same response lists tools from the newest Ready server revision, including the frozen
input schema and digest an agent author must save. The API never returns credentials and never
labels an install connected before a real connection exists.

## Rules

- Only an organization administrator may register, review, approve, or publish a server.
- A server must pass the saved protocol check before it may be approved.
- Network failures, timeouts, rate limits, and server errors are retried. Unsafe addresses and bad
  replies are saved as rejected so the same task cannot keep contacting an unchanged endpoint. A
  temporary failure is tried at most five times, with a longer delay before each later check.
- A user only sees and installs Published, Active servers with a Ready OCI revision when saved access
  grants allow that server.
- An administrator may inspect tools on an unpublished or inactive server. The response marks those
  tools as blocked, and administrator visibility never grants execution permission.
- The package reads saved users and groups. It does not treat raw login claims as access rights.
- Route handlers use the authenticated user's silo. They do not accept a silo from the request body.

## Public surface

- `mcpOperatorRouter` — the Express router mounted at `/api/v1/mcp`.
- `registerRemoteServer` — saves a draft server and its protocol-check job together.
- `__CreateMcpEraProbeWorkflow` — registers the saved background job that checks the server.
- `__CreateOciImageValidationWorkflow` — registers the saved OCI image admission job.
- `mcpTaskRouter` and `__CreateMcpTaskWorkflow` — save, read, resume, cancel, and execute
  caller-owned MCP tasks through the existing OCI runtime.
- `__CreateMcpOciServerPromotionRouter` — promotes an imported image into a draft server revision and
  its first discovery execution for an authenticated organisation administrator.
- `__CreateMcpRuntimeControllerRouter` — exposes the seven TokenReview-protected claim, assignment,
  release, Pod-registration, and terminal-cleanup routes used by the agent controller.
- `__CreateMcpRuntimeCompanionRouter` — exposes the three TokenReview-protected claim, completion,
  and failure routes used by one exact MCP companion Pod.
- `PrismaMcpRuntimeAuthority` — owns the database transactions and delivery fences behind those
  public, controller, and companion routes.
- Operator services: `listEntitledCatalog`, `listInstalled`, `installServer`, `approveServer`,
  `publishServer`, and the access editor. Catalogue server responses include the newest Ready OCI
  tool revisions in stable order.
- `_McpOpenapiPaths` — the OpenAPI path descriptions for this API.

## Boundary

The application supplies the database transaction and starts the Absurd worker. Routes never receive
a Prisma client. `PrismaMcpOperatorUnitOfWork` checks access, changes installs or server state, admits
background jobs, and records audit entries in one database transaction.

This package does not create Kubernetes workloads itself. It governs which servers are available,
promotes imported images, saves public tool tasks, issues database-fenced runtime work, and accepts
results only from the TokenReview-bound controller or companion Pod. The agent controller owns
Kubernetes changes, while the isolated companion performs the actual MCP exchange.

## Dependency direction

Tagged `scope:mcp`: it may depend on the authentication guard, the shared authorization package, the
authenticated user directory, and the engine-neutral workflow contract. It never imports an app or
an Absurd package directly.

## Data and persistence

This package owns the public behavior around `McpServer`, `McpServerInstall`, `McpTask`, and
`OciImageValidation` in
`apps/opencrane/prisma/schema/mcp.prisma`. General `AuthorizationGrant` rows remain owned by the
authorization package. `PrismaMcpOperatorUnitOfWork` is the public MCP database boundary.

## See also

- Parent index: [gateways](../../README.md)
- Related packages: [providers](../../providers/main/README.md) · [model-routing](../../model-routing/main/README.md)
