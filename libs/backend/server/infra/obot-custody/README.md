# @opencrane/backend/server/infra/obot-custody — the Obot custody, attempt-key + MCP-invocation ports

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › obot-custody

## What it owns

This library owns the **boundaries** for working with Obot without ever holding a raw secret in
OpenCrane: **custody** (handing an integration's credential to Obot to keep, receiving only an
opaque reference), **attempt keys** (minting one short-lived Obot API key per run attempt, scoped
to exactly the attempt's MCP server ids), and **MCP invocation** (the legacy server-side call
port). *Obot* is the external tool-connection system OpenCrane runs alongside (see
`apps/_infra/obot`). Each boundary is a **port** — a runtime-neutral contract — and the custody
and attempt-key ports now also ship authenticated HTTP adapters over one shared session.

```
 integrations gateway (org admin supplies a credential)     run dispatch (per attempt)
          │  ProvisionObotCustodyCommand                          │  IssueObotAttemptKeyCommand
          ▼                                                       ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  obot-custody  ◄── HERE                                                  │
 │  ObotCustodyPort · ObotAttemptKeyIssuer · ObotMcpInvocationPort          │
 │  __CreateObotSession → one bearer-authenticated, bounded HTTP exchange   │
 └─────────────────────────────────────────────────────────────────────────┘
          │  ProvisionedObotCustody (opaque reference)            │ { key, keyId } (transient)
          ▼                                                       ▼
 remote Obot management API (/api/mcp-servers, /api/api-keys)
```

**Custody** (`__CreateHttpObotCustodyAdapter`): `provision` creates the remote MCP server from a
catalogue entry, then configures it with the write-only credential — the only exchange that ever
carries secret values. A configure failure is compensated by deleting the created server, then
rethrown. `revoke` deconfigures and deletes, treating 404 as success (idempotent). Invariant: a
custody reference is only ever real if Obot minted it; the platform never synthesises one, and the
fail-closed `__UnavailableObotCustodyAdapter` remains the default when the transport is not
configured.

**The custody reference doubles as Obot's MCP server id.** It is not a credential: the compiled run
input carries it to the runtime as `CompiledToolDefinition.obotMcpServerId` ADDRESSING, and the
runtime pairs it with an attempt-scoped, server-scoped key to execute an approved call directly
against Obot's `/mcp-connect/<id>/mcp` proxy. The underlying integration credential never leaves
Obot; allow-lists and key scoping remain the authority.

**Attempt keys** (`__CreateHttpObotAttemptKeyIssuer`): `issueAttemptKey` posts
`{ name, expiresAt, mcpServerIds }` and validates the returned key value (accepting either the
`key` or `token` field spelling, never guessing) plus the key id used only for revocation.
`revokeAttemptKey` treats 404 as already revoked. The key expires with the attempt assignment
lease and can reach only the named MCP server ids.

**Transport discipline** (`__CreateObotSession`): a release-local `*.svc.cluster.local` HTTP origin
only, the mounted service credential re-read per call, `AbortSignal.timeout`, `redirect: "error"`,
bounded 256 KiB reads, `___DoWithoutTrace` around every fetch, and a bounded failure taxonomy
(`timeout | network | oversize | http_<status>`) as the ONLY detail carried out — remote bodies and
credentials never appear in an error. The exact Obot response shapes are not contract-pinned (live
qualification is gated on issue #337), so every consumed field is validated and anything
unrecognised raises a typed `ObotProtocolError`.

The MCP-invocation port (`ObotMcpInvocationPort`) survives as the server-side contract with only
its fail-closed `__UnavailableObotMcpInvocationAdapter`: the invocation data plane moved to the
runtime, so the server never proxies tool payloads. `__AssertToolAllowed` remains the single
allow-list enforcement point for any implementation.

## Public surface

- `ObotCustodyPort`, `ProvisionObotCustodyCommand`, `ProvisionedObotCustody`, `ObotCustodyCredential`.
- `__CreateHttpObotCustodyAdapter` — the authenticated custody transport.
- `ObotAttemptKeyIssuer`, `IssueObotAttemptKeyCommand`, `IssuedObotAttemptKey`,
  `__CreateHttpObotAttemptKeyIssuer` — attempt-scoped key minting and revocation.
- `__CreateObotSession`, `ObotSession`, `ObotHttpOptions`, `ObotTransportError`, `ObotProtocolError`,
  `ObotTransportFailureCode` — the shared bounded exchange.
- `__UnavailableObotCustodyAdapter`, `ObotCustodyUnavailableError` — the fail-closed default.
- `ObotMcpInvocationPort`, `ObotMcpToolInvocationCommand`, `ObotMcpToolResult`, `__AssertToolAllowed`,
  `__UnavailableObotMcpInvocationAdapter`, `ObotMcpInvocationUnavailableError`, `ObotMcpToolNotAllowedError`.

## Boundary

Consumed by the `integrations` backend gateway (custody route), the app root's Obot adapter factory,
and the run-dispatch attempt-key issuer. It stores nothing and holds no secret beyond the single
in-flight call; minted keys ride the claim response into a per-attempt Kubernetes Secret and are
never persisted or logged.

## Dependency direction

Tagged `scope:obot-custody` (`layer:infra`): it may depend only on `scope:obot-custody` and
`scope:shared` packages — never on backend domains, the frontend, or app entrypoints.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md) · [memory gateway](../memory-gateway-client/README.md)
