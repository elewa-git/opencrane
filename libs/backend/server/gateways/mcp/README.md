# MCP gateway packages

> [backend](../../../../README.md) › [server](../../../README.md) › [gateways](../../README.md) › mcp

MCP means Model Context Protocol, a common way for an AI agent to use tools. These packages govern
which MCP services OpenCrane may use and how an MCP bundle is checked before it can be trusted.

| Package | What it does |
|---|---|
| [`main`](./main/README.md) | Owns MCP catalogue rules, protocol checks, and bundle validation records. |
| [`validator-k8s-launcher`](./validator-k8s-launcher/README.md) | Builds the restricted one-shot Job shape for a future bundle validator worker. |

```
 MCP catalogue and validation record
               │
               ▼
         main package
          │        │
          │        └──► validator-k8s-launcher ──► isolated validator Job
          ▼
    permitted MCP service
```

MCP packages may use IAM decisions and infrastructure ports, but they do not own agent runtime
execution or Kubernetes mutation. The agent controller is the only process that can create Jobs.

## See also

- [Gateway packages](../README.md)
- [Server packages](../../../README.md)
