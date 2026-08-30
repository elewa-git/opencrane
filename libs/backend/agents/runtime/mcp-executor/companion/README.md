# @opencrane/backend/agents/runtime/mcp-executor/companion — one-shot MCP exchange

> [backend](../../../../../README.md) › [agents](../../../../README.md) › [runtime](../../../README.md) › [MCP executor](../README.md) › companion

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

**In this flow:** [MCP protocol](../protocol/README.md) · [Kubernetes launcher](../k8s-launcher/README.md)

The invariant is one claim, at most one tool call, and one terminal report. A malformed, expired,
oversized, redirected, or timed-out exchange fails closed without exposing arguments or results.

## Public surface

- `__CreateMcpCompanionRemote` creates the authenticated companion-to-OpenCrane control channel.
  It rereads the companion's projected token on every request, sends only the Pod identity to the
  fixed in-cluster executor route, receives one server-selected command, and reports through that
  command's `executionId` and `claimFence`. It never contacts the uploaded MCP server or gives that
  server the projected token or opaque execution reference.
- `__CreateMcpCompanionServer` creates the separate fixed loopback adapter used to speak to the
  uploaded MCP server. That server-facing adapter has no OpenCrane credential.
- `__ReadMcpCompanionIdentity` reads and checks the mounted reference and Pod UID.
- `__RunMcpCompanion` waits for controller Pod registration, runs one claim, and sends one terminal report.
  It exits without calling the uploaded server when OpenCrane reports that cancellation already ended the saved work.
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
