# mcp-era-probe — external MCP protocol check

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › mcp-era-probe

## What it owns

This library makes the one external request needed to check a reviewed MCP server before the MCP
domain records it. It owns HTTPS, DNS review, response limits, JSON-RPC validation, and the evidence
digest. It does not own server registration, database writes, workflow scheduling, session setup, or
tool execution.

## What it checks

```text
MCP domain port
      │ probe({ endpoint })
      ▼
mcp-era-probe
      │ resolve every address ──► reject local, private, reserved, or mixed DNS answers
      │ bind HTTPS lookup ──────► the reviewed address, not a second DNS result
      │ POST server/discover ───► MCP-Protocol-Version: 2026-07-28
      ▼
{ protocolVersion, evidenceDigest }
```

In this flow:

- The caller decides whether probing is allowed and what to do with a successful result.
- This adapter rejects URL credentials, IP-literal hosts, redirects, oversized bodies, and malformed
  JSON-RPC. It returns any well-formed announced version; the MCP domain accepts `2026-07-28` and
  records another version as rejected evidence.
- The probe is discovery-only. It does not call `initialize`, create a session, fall back to an
  earlier protocol revision, or contact Obot.

## Public surface

- `__CreateHttpsMcpEraProbeClient(options)` creates the structurally compatible `McpEraProbeClient`.
- `McpEraProbeClient.probe({ endpoint })` returns the declared protocol version and the SHA-256 digest
  of the validated JSON-RPC result.
- `McpEraProbeConfigurationError`, `McpEraProbeTransportError`, and `McpEraProbeProtocolError` carry
  bounded error codes that are safe to store or log.

## Dependency direction

This is `layer:infra` with `scope:mcp`. It may use Node networking, utilities, and observability, but
it never imports the MCP domain or an application composition root. The app assigns this adapter to
the domain port structurally.

## See also

- Parent index: [infra](../README.md)
- MCP specification: [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
