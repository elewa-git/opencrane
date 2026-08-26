# MCP executor runtime

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › MCP executor

This group owns the Kubernetes projection for an MCP (Model Context Protocol) server imported as an
OCI image. The first production shape is a one-use Job. It does not put an uploaded image in the
generic agent runtime Pod, and it does not claim that one fixed warm Pod can run arbitrary images.

| Package | What it owns |
| --- | --- |
| [Kubernetes launcher](./k8s-launcher/README.md) | Pure construction of the suspended MCP server and companion Job. |

```text
saved MCP claim + imported image digest
        │
        ▼
mcp-executor/k8s-launcher ◄── HERE
        │ suspended Job with two isolated containers
        ▼
agent-controller records the Job UID before release
```

The uploaded server receives no OpenCrane token. An OpenCrane-owned companion holds the projected
token, calls the server over Pod-local networking, and reports through an authenticated internal API.

## See also

- Parent: [runtime](../README.md)
- Shared claim: [workloads/contract](../workloads/contract/README.md)
