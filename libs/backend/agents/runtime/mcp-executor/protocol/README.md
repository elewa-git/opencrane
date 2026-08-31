# @opencrane/backend/agents/runtime/mcp-executor/protocol — MCP 2026-07-28 exchange

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [runtime](../../../README.md) › [MCP executor](../README.md) › protocol

## What it owns

This package builds and checks the JSON-RPC messages exchanged between the OpenCrane companion and
an uploaded MCP (Model Context Protocol) server. It accepts only MCP `2026-07-28`: discovery must
announce that version before tools can be listed or called.

```text
OpenCrane MCP companion
        │ server/discover · tools/list · tools/call
        ▼
┌──────────────────────────────────┐
│ MCP executor protocol ◄── HERE    │
└──────────────────────────────────┘
        │ checked JSON values only
        ▼
uploaded MCP server on Pod-local HTTP
```

The package does not open a socket, select an image, read credentials, or decide whether a tool call
is allowed. The caller must compare listed tools with the saved server revision and the existing
ToolInvocation authority before it builds a call.

## Public surface

- `__BuildMcpExecutorDiscoveryRequest` and `__ParseMcpExecutorDiscoveryResponse` handle version discovery.
- `__BuildMcpExecutorToolsListRequest` and `__ParseMcpExecutorToolsListResponse` handle tool schemas.
- `__BuildMcpExecutorToolCallRequest` and `__ParseMcpExecutorToolCallResponse` handle one saved invocation.
- `MCP_EXECUTOR_PROTOCOL_VERSION` is the only accepted protocol revision.

## Boundary

Every response must be a matching JSON-RPC success envelope with valid fields. The future transport
must enforce the response-byte limit before parsing. Protocol errors and provider failures remain
failures; the parser never invents an empty success.

## Dependency direction

Tagged `scope:mcp-runtime` and `layer:backend`; it depends only on dependency-light JSON utilities.
It never imports an app, Kubernetes, Prisma, the MCP gateway, or a network adapter.

## See also

- Parent: [MCP executor runtime](../README.md)
- Job projection: [Kubernetes launcher](../k8s-launcher/README.md)
- MCP governance: [MCP gateway](../../../../server/gateways/mcp/main/README.md)
