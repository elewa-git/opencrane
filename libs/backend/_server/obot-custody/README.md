# @opencrane/backend/_server/obot-custody — the Obot credential-custody + MCP-invocation ports

> [backend](../../README.md) › [_server](../README.md) › obot-custody

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
and then refuses. Tests that need a successful invocation provide a local recording double without
publishing a fake-success adapter from this infrastructure package.

## Public surface

- `ObotCustodyPort` — the runtime-neutral provision/revoke contract.
- `ProvisionObotCustodyCommand`, `ProvisionedObotCustody`, `ObotCustodyCredential` — the I/O types.
- `__UnavailableObotCustodyAdapter`, `ObotCustodyUnavailableError` — the fail-closed default and its error.
- `ObotMcpInvocationPort`, `ObotMcpToolInvocationCommand`, `ObotMcpToolResult` — the MCP-invocation contract and I/O.
- `__AssertToolAllowed` — the single allow-list enforcement point every adapter calls.
- `__UnavailableObotMcpInvocationAdapter`, `ObotMcpInvocationUnavailableError`, `ObotMcpToolNotAllowedError`.

## Boundary

Consumed by the `integrations` backend gateway (custody) and by the external-action executor
(MCP invocation). Neither boundary has an authenticated concrete transport yet, so the unavailable
adapters remain the only production implementations. It stores nothing and holds no secret beyond
the single in-flight call.

## Dependency direction

Tagged `scope:obot-custody` (`layer:infra`): it may depend only on `scope:obot-custody` and
`scope:shared` packages — never on backend domains, the frontend, or app entrypoints.

## See also

- Parent index: [_server](../README.md) · [backend libraries](../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md) · [memory gateway](../memory-gateway-client/README.md)
