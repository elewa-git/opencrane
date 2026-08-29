# @opencrane/backend/agents/runtime/mcp-executor/k8s-launcher — OCI MCP Jobs

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [runtime](../../../README.md) › [MCP executor](../README.md) › Kubernetes launcher

## What it owns

This package turns one database-issued MCP workload claim into a suspended Kubernetes Job. The
admitted OCI image runs as a Kubernetes native sidecar, while a fixed OpenCrane companion checks MCP
`2026-07-28` and exchanges one authenticated unit of work with the server API. Kubernetes stops the
sidecar after the companion exits, so the one-use Job can complete normally.

```text
MCP claim + registry/repository@sha256:...
        │
        ▼
┌───────────────────────────────────┐
│ MCP Job launcher ◄── HERE          │
└───────────────────────────────────┘
        │ suspended two-container Job
        ▼
agent-controller binds UID, then releases
```

**In this flow:** [MCP governance](../../../../server/gateways/mcp/main/README.md) issues the claim;
the [agent controller](../../../../../../apps/agent-controller/README.md) is the only Kubernetes
writer; the planned `apps/mcp-executor` companion performs the protocol exchange.

The uploaded image receives no projected token, claim file, credential, Service, or ingress. Both
containers run without privilege, with read-only roots and separate temporary filesystems. The
companion initiates every exchange, so it does not expose a local credential service to the uploaded
container.

## Public surface

- `__BuildSuspendedMcpExecutorJob` validates and builds one Job.
- `McpExecutorJobAssignment` carries the saved claim, image digest, and namespace.
- `McpExecutorJobProfile` carries fixed deployment identity, companion image, endpoint, and limits.

## Boundary

The package performs no input/output. It does not read PostgreSQL, call Kubernetes, admit an OCI ZIP,
read a credential, execute a tool, or change claim state. The controller must record the Job UID
before it removes `suspend: true`.

## Dependency direction

Tagged `scope:mcp-runtime` and `layer:infra`; it depends only on the shared workload claim and
Kubernetes manifest types. It never imports an app, Prisma, the MCP gateway, or server infrastructure.

## Runtime & config

The uploaded and companion images must be pinned by SHA-256 digest. The profile fixes the dedicated
namespace, `mcp-executor-default` ServiceAccount, internal server endpoint, 10-minute maximum lifetime,
short-lived `opencrane-mcp-executor` token, and bounded resources.

## See also

- Parent: [MCP executor runtime](../README.md)
- Shared claim: [workloads/contract](../../workloads/contract/README.md)
- Existing runtime launcher: [runtime/k8s-launcher](../../k8s-launcher/README.md)
