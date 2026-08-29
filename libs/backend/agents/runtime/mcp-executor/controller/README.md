# @opencrane/backend/agents/runtime/mcp-executor/controller — MCP Job reconciliation

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [runtime](../../../README.md) › [MCP executor](../README.md) › controller

## What it owns

This package turns a database-issued MCP workload claim into one OCI-backed Kubernetes Job. The
OpenCrane server selects the imported image and deployment profile. The controller builds the Job,
records its Kubernetes UID, releases that same Job, and records its first Pod UID.

```text
saved MCP claim + imported image digest
        │
        ▼
MCP executor controller ◄── HERE
        │ suspended Job → saved UID → release → first Pod
        ▼
shared exact governed Job controller
```

## Public surface

- `__RunMcpExecutorController` runs the abortable reconciliation loop.
- `__CreateHttpMcpExecutorControllerAuthority` calls the server with a rotating projected token.
- `__CreateKubernetesMcpExecutorControllerStore` selects the MCP labels and trace name for the
  shared governed Job controller.
- `__ValidateMcpExecutorControllerProfile` checks the deployment-owned profile at startup.

## Boundary

The controller cannot accept an image, namespace, ServiceAccount, or companion setting from a user
request. It receives the immutable registry reference from server authority and the rest from its
deployment profile. It does not execute MCP or read OCI ZIP files.

## Dependency direction

Tagged `scope:mcp-runtime` and `layer:infra`, this package depends on the MCP Job builder, shared
workload contracts, the exact governed Job controller, observability, and Kubernetes client types.
The `agent-controller` app composes it; no library depends on that app.

## See also

- [MCP executor runtime](../README.md)
- [MCP Job launcher](../k8s-launcher/README.md)
- [Shared governed Job controller](../../workloads/k8s-controller/README.md)
