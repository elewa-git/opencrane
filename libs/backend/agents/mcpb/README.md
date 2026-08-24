# MCP bundle controller packages

> [backend](../../../README.md) › [agents](../../README.md) › mcpb

This group contains the reusable controller logic that projects saved MCP bundle inspection work
into a restricted Kubernetes Job. The OpenCrane server keeps the product record and workflow; these
packages do not decide whether a bundle is trusted.

| Package | What it owns |
| --- | --- |
| [`controller`](./controller/README.md) | Claims saved inspection work and creates its suspended validator Job. |

```
 OpenCrane workflow ──► controller ──► suspended validator Job
```

The group may depend on shared contracts and the fixed validator-Job builder. It never imports an
app, database adapter, or MCP product authority.

## See also

- Parent group: [agents](../../README.md)
- Related package: [MCP governance](../../../server/gateways/mcp/main/README.md)
