# libs/backend — server-owned capabilities

> [OpenCrane](../../README.md) › backend

Backend libraries are grouped first by the application that owns their composition boundary. The
OpenCrane API server owns the capabilities under `server/`; its process-only transport and platform
support lives under [`server/infra`](./server/infra/README.md), so business capabilities do not become mixed with
server machinery. [`observability`](./observability/) is the shared logging and tracing capability for
server-side processes. Apps remain thin entrypoints that mount routers, construct clients, and
manage process lifecycle.
Reusable conversation processing lives under [`conversations`](./conversations/README.md). Its
projection package has no server transport or database authority, so participant and channel routes
can compose the same safe stream.

## Layout

```text
libs/backend/
  agents/                     agent specializations and shared execution authority
    personal/<domain>/main    personal persona, memory, and conversation domains
    execution/<domain>/main   input assembly and run-attempt domains
    execution/protocol        language-neutral command/candidate authority
    runtime/k8s-launcher      agent-controller Job projection
  conversations/              transport-neutral conversation processing
    projection/main           safe resumable browser event stream
  server/<group>/<domain>/main OpenCrane server capability
    project.json              Nx project metadata and targets
    src/index.ts              public barrel
    src/routes/               Express transport adapters
    src/core/                 domain services and use cases
    src/__tests__/             capability tests
  server/infra/<capability>/   server runtime and external-I/O seams
  observability/               structured logging and execution tracing
```

The `/main` level lets a capability namespace gain a deliberately separate peer later without
flattening unrelated responsibilities together.

## Current functional domains

The server map is grouped into IAM, managed agents, gateway governance, knowledge, tenancy, and
reporting. See [`server/README.md`](./server/README.md) for the member map and why `api-spec`
remains outside every group. Agent specializations and shared execution/runtime domains are mapped
separately under [`agents/README.md`](./agents/README.md); they do not become operator/server
capabilities merely because the OpenCrane app currently composes some of their ports.

## Dependency rules

- Server capabilities may depend on models, contracts, utilities, `server/infra` support, observability,
  and explicit backend peers; they never depend on an app.
- Cross-capability imports use a public barrel such as
  `@opencrane/backend/server/<group>/<domain>`, never an internal source path.
- Server-runtime imports use `@opencrane/backend/server/infra/<runtime>`; server-side logging and tracing
  imports use `@opencrane/backend/observability`.
- Agent runtime imports use `@opencrane/backend/agents/execution/protocol` for authority and
  `@opencrane/backend/agents/runtime/k8s-launcher` for the controller projection.
- Conversation transports import `@opencrane/backend/conversations/projection` for the shared
  display-safe stream; the projection package does not import the transports back.
- Database models remain in the OpenCrane app's per-domain Prisma schema files; see
  [`docs/agents/prisma.md`](../../docs/agents/prisma.md).

## Adding a server capability

1. Create `libs/backend/server/<group>/<domain>/main` by copying a small peer such as
   `libs/backend/server/iam/audit/main`.
2. Name its Nx project `backend-server-<domain>` and update `sourceRoot`, target working
   directories, and its root-relative TypeScript and Vitest paths.
3. Add `@opencrane/backend/server/<group>/<domain>` to the root `tsconfig.json` paths.
4. Export only the public capability surface from `src/index.ts` and mount transport adapters from
   `apps/opencrane`.
5. Add or update the app-owned Prisma schema slice when the capability owns durable models.
6. Run the project's lint and test targets plus `npm run lint:boundaries`.

The server container copies `libs` wholesale and bundles the app's source dependency closure, so a
new source-only backend library does not need its own Dockerfile.

## See also

- Parent front door: [OpenCrane](../../README.md)
- Server capabilities: [server](./server/README.md)
- Agent capabilities: [agents](./agents/README.md)
- Reusable conversation processing: [conversations](./conversations/README.md)
- Server runtime seams: [server/infra](./server/infra/README.md)
- Telemetry: [observability](./observability/README.md)
