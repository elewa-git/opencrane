# @opencrane/backend/agents/runtime/mcp-file-generator — bounded CSV MCP server

> [backend](../../../../README.md) › [agent runtime](../../README.md) › mcp-file-generator

## What it owns

This package implements the credentialless MCP (Model Context Protocol) server that turns admitted
table arguments into a CSV file. It validates the request again inside the isolated OCI job through the shared CSV model, renders
the bytes without filesystem or network access, and returns one embedded text resource.

```text
admitted MCP tool invocation ........ display name · headers · rows
        │
        ▼
┌────────────────────────────────────┐
│ mcp-file-generator  ◄── HERE       │ validate · render · answer on loopback
└────────────────────────────────────┘
        │ one embedded text/csv resource
        ▼
MCP companion ........ fenced result delivery to OpenCrane
```

**In this flow:** [MCP executor](../../mcp-executor/README.md) · [generated-file app](../../../../../../apps/mcp-file-generator/README.md)

The renderer rejects record-breaking controls and formula-leading strings. It supports negative
numeric values because they stay JSON numbers and render as numeric CSV cells. Requests and output
bytes each have a one MiB ceiling.

## Public surface

- `__CreateMcpFileGeneratorServer` creates the HTTP server used by the OCI image.
- The exported contract constants give the app and tests the tool name, loopback address, and
  resource metadata URI.

The [conversation-assets model](../../../../../models/conversation-assets/main/README.md) owns
`___CreateCsvFile`, its input schema and limits. The producer and server capture use that same
validator and renderer so the server can compare the returned bytes to the admitted arguments.

## Boundary

This package owns no installation, assignment, grant, task, Artifact, or conversation state. The
resource URI is metadata and grants no authority. OpenCrane's existing MCP companion controls the
call fence and the later server-side consumer decides whether returned bytes may become an Artifact.

## Dependency direction

Tagged `scope:mcp-runtime` and `layer:backend`, this library depends on shared MCP contracts,
observability, the pure conversation-assets CSV model, and dependency-light utilities. It never imports an app or server persistence owner.

## Runtime & config

The app binds the server to `127.0.0.1:3000/mcp`. The library reads no environment variables,
credentials, paths, or remote addresses.

## See also

- [Agent runtime index](../../README.md)
- [MCP executor runtime](../../mcp-executor/README.md)
