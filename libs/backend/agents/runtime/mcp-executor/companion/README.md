# @opencrane/backend/agents/runtime/mcp-executor/companion — one-shot MCP exchange

> [backend](../../../../README.md) › [agents](../../../README.md) › [runtime](../../README.md) › [MCP executor](../README.md) › companion

## What it owns

This package runs the OpenCrane-owned side of one OCI-backed MCP (Model Context Protocol) Job. It
reads the projected execution reference, claims one server-selected command, talks only to the
uploaded server on Pod-local HTTP, and returns checked data through the current claim fence.

```text
OpenCrane execution authority .... exact discovery or invocation claim
        │
        ▼
┌──────────────────────────────────┐
│ MCP executor companion ◄── HERE  │ token reread · bounded exchange
└──────────────────────────────────┘
        │ checked tools, result, or stable failure code
        ▼
OpenCrane execution authority .... fenced terminal write
```

**In this flow:** the shared `@opencrane/contracts` MCP protocol helpers build and validate the
standard requests and responses; the [Kubernetes launcher](../k8s-launcher/README.md) supplies the
fixed loopback endpoint.

The invariant is one claim, at most one tool call, and one terminal report. Discovery reads all
bounded pages under one deadline and rejects duplicate names or cursor loops. Calls use the frozen
input schema from the claim and do not rediscover mutable server state. JSON and request-scoped SSE
responses are bounded; a matching SSE result cancels the stream before the companion reports it.
Malformed, expired, oversized, redirected, or timed-out exchanges fail closed without exposing
arguments or results.

## Public surface

- `__CreateMcpCompanionRemote` creates the projected-token OpenCrane adapter.
- `__CreateMcpCompanionServer` creates the fixed loopback MCP adapter.
- `__ReadMcpCompanionIdentity` reads and checks the mounted reference and Pod UID.
- `__RunMcpCompanion` waits for controller Pod registration, claims one saved command, and then
  waits for the uploaded server to become ready under that command's deadline. A readiness failure
  is reported through the same claim instead of leaving the database work stuck. It exits without
  calling the uploaded server when OpenCrane reports that cancellation already ended the saved work.
- The exported wire parsers give the server route the same strict claim and report contract.

## Boundary

The package has no Kubernetes client, database, image selection, permission decision, retry loop,
or listener. The server binds TokenReview evidence, Pod UID, reference, delivery, fence, and expiry.

## Dependency direction

Tagged `scope:mcp-runtime` and `layer:backend`, it depends on the MCP protocol and observability
barrels. Apps and durable server authorities may consume it; it never imports either.

## See also

- Parent: [MCP executor](../README.md)
- Process owner: [mcp-executor app](../../../../../../apps/mcp-executor/README.md)
