# @opencrane/backend/server/gateways/mcp/validator-k8s-launcher — MCP bundle validator Job builder

> [backend](../../../../../README.md) › [server](../../../../README.md) › [gateways](../../../README.md) › mcp › validator-k8s-launcher

## What it owns

An MCP bundle is a packaged Model Context Protocol server. Before OpenCrane can trust one, a future
validator worker must inspect it in a small, isolated Kubernetes Job. This package builds that Job
shape; it does not submit the Job, read bundle bytes, or run a bundle.

```
 saved validation + opaque reference
              │
              ▼
 ┌──────────────────────────────────────┐
 │ validator-k8s-launcher  ◄── HERE      │ checks the fixed worker identity,
 └──────────────────────────────────────┘ token, resources, and Job shape
              │
              ▼
 agent controller ──► one suspended validator Job
```

**In this flow:** [MCP governance](../main/README.md) · [agent controller](../../../../../../../apps/agent-controller/README.md) · [validator app](../../../../../../../apps/mcpb-validator/README.md).

It guarantees the Job is one-shot, starts suspended, has no Kubernetes permissions, uses a
read-only filesystem, and receives only a short-lived token plus an opaque reference. If the profile
or assignment would widen those limits, it refuses to make a manifest.

## Public surface

- `__BuildMcpbValidatorJob` builds one restricted, suspended Kubernetes Job.
- `__McpbValidatorJobName` derives its opaque deterministic Kubernetes name.
- `McpbValidatorJobProfile` and `McpbValidatorJobAssignment` describe trusted deployment settings and controller input.

## Boundary

The future MCPB controller is the only caller that may submit this Job. This package never handles
artifact locations, bundle bytes, commands, database connections, or long-lived credentials.

## Dependency direction

Tagged `scope:mcp-validator-launcher`, this infrastructure package only uses Kubernetes value types
and Node's hashing helper. It does not import apps, database adapters, or MCP business rules.

## See also

- [Gateway packages](../../../README.md)
- [MCP governance](../main/README.md)
- [Validator application](../../../../../../../apps/mcpb-validator/README.md)
