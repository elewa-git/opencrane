# MCP executor runtime

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › MCP executor

This group owns the Kubernetes projection for an MCP (Model Context Protocol) server imported as an
OCI image. The first production shape is a one-use Job. It does not put an uploaded image in the
generic agent runtime Pod, and it does not claim that one fixed warm Pod can run arbitrary images.

| Package | What it owns |
| --- | --- |
| [Controller](./controller/README.md) | Claims, assigns, releases, and records OCI-backed MCP Jobs. |
| [Companion](./companion/README.md) | One-shot OpenCrane claim, Pod-local MCP exchange, and fenced report. |
| [Kubernetes launcher](./k8s-launcher/README.md) | Pure construction of the suspended MCP server and companion Job. |
| [Protocol](./protocol/README.md) | Strict MCP 2026-07-28 discovery, tool-list, and tool-call messages. |

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
- Protocol: [MCP executor protocol](./protocol/README.md)
- Companion: [MCP executor companion](./companion/README.md)
