# @opencrane/backend/server/infra/mcp-remote-client — standard remote MCP transport

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › mcp-remote-client

## What it owns

This library performs bounded HTTPS exchanges with standard remote MCP servers. It owns endpoint
normalization, DNS and address review, TLS socket pinning, redirects, deadlines, response limits,
JSON or SSE decoding, and request-scoped bearer authorization. Shared MCP contracts build and
validate protocol messages pinned to `2026-07-28`.

```text
MCP domain port
      │ discover / listTools / callTool
      ▼
mcp-remote-client
      │ resolve every address ──► reject local, private, reserved, or mixed DNS answers
      │ bind HTTPS lookup ──────► one reviewed address and the saved TLS hostname
      │ add ephemeral bearer ──► transport header only, after protocol headers
      │ bounded POST ───────────► JSON or request-scoped SSE response
      ▼
validated discovery evidence / tool page / tool result
```

The caller owns endpoint and credential custody, current authority, catalogue pagination, saved tool
revisions, invocation admission, and result delivery. This package never persists a token, follows a
redirect, retries a tool call, registers a server, or creates a workflow.

## Public surface

- `__CreateHttpsMcpRemoteClient(options)` creates the standard transport.
- `discover(command)` returns the announced protocol version and evidence digest.
- `listTools(command)` returns one validated page and its opaque continuation.
- `callTool(command)` sends one already-admitted invocation. Its frozen input schema permits only
  reviewed `Mcp-Param-*` headers; callers cannot supply arbitrary headers.
- `McpRemoteConfigurationError`, `McpRemoteTransportError`, and `McpRemoteProtocolError` expose
  bounded codes without endpoint, response, token, or argument data.

## Failure boundary

Every failure states whether delivery is `proven_not_dispatched` or `maybe_dispatched`. Endpoint,
authorization, DNS-policy, and caller cancellation failures before the request begins are proven
pre-dispatch. Once the request operation starts, socket, HTTP, timeout, cancellation, size, framing,
and protocol failures are conservatively maybe-dispatched. An effect owner may close unused work
only from the first state; it must retain uncertain evidence from the second state.

The trace span records only the operation name and pinned protocol version. The external endpoint,
authorization, headers, arguments, response, and native error text stay outside trace attributes and
bounded public errors.

## Dependency direction

This is `layer:infra` with `scope:mcp`. It may use Node networking, shared contracts, utilities, and
observability. It does not import the MCP domain or an application composition root. The app assigns
it structurally to domain ports.

## See also

- Parent index: [infra](../README.md)
- MCP specification: [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
