# @opencrane/mcp-file-generator — credentialless CSV tool image

> [apps](../README.md) › mcp-file-generator

## What it owns

This app is the process and image owner for OpenCrane's CSV-generating MCP (Model Context Protocol)
server. An administrator can admit its immutable image through the existing OCI tool flow. The MCP
executor then runs it as the uncredentialed server container beside the authenticated companion.
Its MCP discovery and runtime name is `opencrane_files_create_csv`. The server compiler gives
each admitted revision a separate model declaration name.

```text
runtime-created MCP Job
        │ admitted table arguments over loopback HTTP
        ▼
┌────────────────────────────────────┐
│ mcp-file-generator app ◄── HERE    │ fixed listener · telemetry · shutdown
└────────────────────────────────────┘
        │ one embedded UTF-8 CSV resource
        ▼
existing MCP companion and result fence
```

**In this flow:** [generator library](../../libs/backend/agents/runtime/mcp-file-generator/main/README.md) · [MCP executor](../mcp-executor/README.md)

The app binds only to loopback. It has no credential, filesystem, provider, OpenCrane API, or
outbound network adapter. CSV validation and rendering live in the library.

## Public surface

Entrypoint: `src/index.ts` starts `127.0.0.1:3000/mcp`, handles shutdown signals, and flushes
telemetry.

## Boundary

The existing MCP catalogue owns image promotion, tool discovery, installation, assignment, grants,
and invocation. This app never creates those records and does not publish Artifacts or conversation
files. Its resource URI is descriptive metadata and is never a download or storage address.

## Dependency direction

Tagged `scope:mcp-runtime` and `layer:entrypoint`, this app imports the generator library and shared
observability package. No library imports this app.

## Runtime & config

The listener address, tool name, request ceiling, and generated-byte ceiling are fixed in source.
The only optional runtime configuration belongs to shared OpenTelemetry environment variables. The
image runs as UID and GID 65532 with no write path supplied by its Dockerfile. Its app-owned
`image-smoke` target builds the production image without network access at runtime, starts its normal
entrypoint, and exercises discovery, tool listing, and one exact CSV call over container loopback.

## See also

- [Apps index](../README.md)
- [MCP executor runtime](../../libs/backend/agents/runtime/mcp-executor/README.md)
