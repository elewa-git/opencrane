# @opencrane/backend/server/infra/obot-custody — Obot custody and server invocation ports

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › obot-custody

## What it owns

This library owns the **boundaries** for working with Obot without ever holding a raw secret in
OpenCrane: **custody** (handing an integration's credential to Obot to keep, receiving only an
opaque reference) and **MCP invocation** from the trusted server action worker. *Obot* is the
external tool-connection system OpenCrane runs alongside (see
`apps/_infra/obot`). Each boundary is a **port** — a runtime-neutral contract — and the custody
and invocation ports use authenticated HTTP adapters over one shared session.

```
 integrations gateway (org admin supplies a credential)     server action worker
          │  ProvisionObotCustodyCommand                          │  ObotMcpToolInvocationCommand
          ▼                                                       ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  obot-custody  ◄── HERE                                                  │
 │  ObotCustodyPort · ObotMcpInvocationPort                                 │
 │  __CreateObotSession → one bearer-authenticated, bounded HTTP exchange   │
 └─────────────────────────────────────────────────────────────────────────┘
          │  ProvisionedObotCustody (opaque reference)            │ bounded tool result
          ▼                                                       ▼
 remote Obot APIs (/api/mcp-servers · /mcp-connect/<id>/mcp)
```

**Custody** (`__CreateHttpObotCustodyAdapter`): `provision` creates the remote MCP server from a
catalogue entry, then configures it with the write-only credential — the only exchange that ever
carries secret values. A configure failure is compensated by deleting the created server, then
rethrown. `revoke` deconfigures and deletes, treating 404 as success (idempotent). Invariant: a
custody reference is only ever real if Obot minted it; the platform never synthesises one, and the
fail-closed `__UnavailableObotCustodyAdapter` remains the default when the transport is not
configured.

**The custody reference doubles as Obot's MCP server id.** It is not a credential, but it still
stays behind server-owned action execution. The server resolves it only after durable admission and
authorization; the runtime receives neither Obot addressing nor Obot credentials.

**Invocation** (`__CreateHttpObotMcpInvocationAdapter`): the server worker supplies the live custody
reference, immutable tool allow-list, and validated arguments. The adapter checks the allow-list
before transport, performs the Model Context Protocol (MCP) initialize exchange, echoes only the
validated session id, then calls the admitted tool. It accepts bounded JSON or server-sent event
responses and returns only the validated `content` value. Invalid shapes raise a static protocol
error; provider error bodies never leave the transport. A valid MCP `isError: true` result remains
a typed tool failure for the durable worker to record, rather than being mistaken for success.

**Transport discipline** (`__CreateObotSession`): a release-local `*.svc.cluster.local` HTTP origin
only, the mounted service credential re-read per call, a per-request timeout plus process-shutdown
abort signal, `redirect: "error"`,
bounded 256 KiB reads, `___DoWithoutTrace` around every fetch, and a bounded failure taxonomy
(`timeout | network | oversize | http_<status>`) as the ONLY detail carried out — remote bodies and
credentials never appear in an error. The exact Obot response shapes are not contract-pinned (live
qualification is gated on issue #337), so every consumed field is validated and anything
unrecognised raises a typed `ObotProtocolError`.

The MCP-invocation port (`ObotMcpInvocationPort`) is the server-side action boundary. Its complete
handshake runs under the safe `obot.mcp.invoke` operation span, while the credential-bearing HTTP
children stay suppressed. `__AssertToolAllowed` remains the single allow-list enforcement point for
every implementation.

## Public surface

- `ObotCustodyPort`, `ProvisionObotCustodyCommand`, `ProvisionedObotCustody`, `ObotCustodyCredential`.
- `__CreateHttpObotCustodyAdapter` — the authenticated custody transport.
- `__CreateHttpObotMcpInvocationAdapter` — authenticated, allow-listed server-side tool invocation.
- `__CreateObotSession`, `ObotSession`, `ObotHttpOptions`, `ObotTransportError`, `ObotProtocolError`,
  `ObotTransportFailureCode`, `ObotMcpExchangeResponse` — the shared bounded exchange.
- `__UnavailableObotCustodyAdapter`, `ObotCustodyUnavailableError` — the fail-closed default.
- `ObotMcpInvocationPort`, `ObotMcpToolInvocationCommand`, `ObotMcpToolResult`, `__AssertToolAllowed`,
  `__UnavailableObotMcpInvocationAdapter`, `ObotMcpInvocationUnavailableError`,
  `ObotMcpToolNotAllowedError`, `ObotMcpAuthenticationError`, `ObotMcpAuthorizationError`.

## Boundary

Consumed by the `integrations` backend gateway (custody route), the app root's Obot adapter factory,
and the server action worker. It stores nothing and holds no secret beyond a single in-flight call.

## Dependency direction

Tagged `scope:obot-custody` (`layer:infra`): it may depend only on `scope:obot-custody` and
`scope:shared` packages — never on backend domains, the frontend, or app entrypoints.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md) · [memory gateway](../memory-gateway-client/README.md)
