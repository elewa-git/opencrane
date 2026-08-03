# @opencrane/server/_infra/obot-custody — the Obot credential-custody + MCP-invocation ports

> [server](../../README.md) › [_infra](../README.md) › obot-custody

## What it owns

This library owns two **boundaries** for working with Obot without ever holding a raw secret in
OpenCrane: **custody** (handing an integration's credential to Obot to keep, receiving only an opaque
reference) and **MCP invocation** (calling a tool *through* that opaque reference). *Obot* is the
external tool-connection system OpenCrane runs alongside (see `apps/_infra/obot`). Both are
**ports** — runtime-neutral contracts (TypeScript interfaces) that say *what* operations exist, with
the real transport wired in elsewhere.

It sits between the integrations backend and the remote Obot authority:

```
 integrations gateway  (user connects a tool, supplies a credential)
          │  ProvisionObotCustodyCommand  (write-only credential)
          ▼
 ┌────────────────────────────┐
 │  obot-custody  ◄── HERE     │  ObotCustodyPort: provision · revoke
 └────────────────────────────┘
          │  ProvisionedObotCustody  (Obot-minted opaque reference + expiry)
          ▼
 remote Obot management authority
```

**In this flow:** the `integrations` backend gateway *(sole consumer)* · the remote Obot authority
*(mints the reference)*

It owns: the `ObotCustodyPort` interface (`provision` / `revoke`); the request/result types where
the credential is **write-only** (passed straight through, never persisted, logged, or returned) and
the result carries only an Obot-originated opaque reference plus its remote expiry; and a
**fail-closed** default implementation, `__UnavailableObotCustodyAdapter`, which throws
`ObotCustodyUnavailableError` for every call. That default ships until an authenticated Obot
management transport is verified, so no code path can mint a fake local custody handle in the
meantime. Invariant: a custody reference is only ever real if Obot minted it — the platform never
synthesises one, and absent a working transport the answer is a hard failure, not a placeholder.

The MCP-invocation port lets a managed (central) agent call an allow-listed tool through a custody
reference. The command names only the **opaque** `obotCustodyReference` — the runtime never receives
the credential — plus the tool, its validated arguments, and the immutable `allowedTools` allow-list
copied from the revision's `AgentRevisionIntegrationAssignment`. Every implementation enforces the
allow-list FIRST (`__AssertToolAllowed`), so a tool outside the assignment is rejected fail-closed
regardless of transport. The `__UnavailableObotMcpInvocationAdapter` default enforces the allow-list
and then refuses; `__FakeObotMcpInvocationAdapter` is the test/offline double.

### The real MCP transport

`__CreateHttpObotMcpInvocationAdapter` is the production adapter. It speaks the **streamable-HTTP**
MCP transport that Obot exposes at `/mcp-connect/{server-id}` — a hand-written JSON-RPC client, no
MCP SDK dependency. One invocation is one session: `initialize` (capturing any `Mcp-Session-Id`) →
`notifications/initialized` → a single `tools/call` → a best-effort session `DELETE` that never turns
a completed call into a failure. Both JSON and SSE framings are accepted, and an SSE body is scanned
for the envelope whose JSON-RPC id matches the request, so unrelated events are skipped rather than
mistaken for the answer.

The `obotCustodyReference` is treated as the **opaque** gateway server id: it is percent-encoded into
the path and never parsed, split, or synthesised. Failures are typed and bounded — a
`ObotMcpTransportError` carries only a `timeout | network | oversize | http_<status>` code, a
`ObotMcpRemoteRefusalError` names only the tool, and a `ObotMcpProtocolError` marks an unusable
response. **No remote payload, tool argument, or custody reference ever reaches an error message or
a trace attribute.** Responses are read through a 256 KiB allocation ceiling.

Absent an `OBOT_MCP_GATEWAY_URL`, the composition root keeps the fail-closed stub, so a deployment
without Obot behaves exactly as before.

## Public surface

- `ObotCustodyPort` — the runtime-neutral provision/revoke contract.
- `ProvisionObotCustodyCommand`, `ProvisionedObotCustody`, `ObotCustodyCredential` — the I/O types.
- `__UnavailableObotCustodyAdapter`, `ObotCustodyUnavailableError` — the fail-closed default and its error.
- `ObotMcpInvocationPort`, `ObotMcpToolInvocationCommand`, `ObotMcpToolResult` — the MCP-invocation contract and I/O.
- `__AssertToolAllowed` — the single allow-list enforcement point every adapter calls.
- `__UnavailableObotMcpInvocationAdapter`, `__FakeObotMcpInvocationAdapter`, `ObotMcpInvocationUnavailableError`, `ObotMcpToolNotAllowedError`.
- `__CreateHttpObotMcpInvocationAdapter`, `ObotMcpInvocationHttpOptions`, `ObotMcpFetch` — the real streamable-HTTP transport and its configuration.
- `ObotMcpTransportError`, `ObotMcpRemoteRefusalError`, `ObotMcpProtocolError`, `ObotMcpTransportFailureCode` — the bounded failure taxonomy.

## Boundary

Consumed by the `integrations` backend gateway (custody) and by the external-action executor
(MCP invocation). The MCP transport talks to Obot; **custody provisioning does not yet** — its
concrete adapter is wired when the Obot management API contract is confirmed, so
`__UnavailableObotCustodyAdapter` remains the only custody implementation. It stores nothing and
holds no secret beyond the single in-flight call.

## Dependency direction

Tagged `scope:obot-custody` (`layer:infra`): it may depend only on `scope:obot-custody` and
`scope:shared` packages — never on backend domains, the frontend, or app entrypoints.

## See also

- Parent index: [_infra](../README.md) · [server libraries](../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md) · [memory gateway](../memory-gateway-client/README.md)
