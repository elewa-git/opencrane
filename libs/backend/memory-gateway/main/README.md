# @opencrane/backend/memory-gateway — the private memory provider connection

> [backend](../../README.md) › [memory-gateway](../README.md) › main

## What it owns

This library supplies the private memory gateway's provider connection. Its authentication client
logs in to Cognee, holds the login token in memory and refreshes it once when the provider rejects
an expired session. Its HTTP client bounds requests and responses and removes provider details from
errors. Its document reader returns a locked, content-free snapshot with byte digests, and its
blocking Cognify operation binds that snapshot to the caller's saved operation and the provider's
stable pipeline receipt. The other gateway operations and app composition remain in progress.

```text
OpenCrane server ── authenticated gateway request ──► memory-gateway app
                                                           │ planned composition
                                                           ▼
                                            ┌────────────────────────┐
                                            │ this library ◄── HERE  │
                                            └──────────────┬─────────┘
                                                           │ provider session
                                                           ▼
                                                         Cognee
```

**In this flow:** [OpenCrane](../../../../apps/opencrane/README.md) ·
[memory-gateway app](../../../../apps/memory-gateway/README.md) ·
[Cognee](../../../../apps/_infra/cognee/README.md).

Provider credentials and login tokens stay in the gateway process. A failed or ambiguous provider
response must remain a failure: it cannot become an empty recall or trigger an unbounded retry.

## Public surface

The library has no published runtime exports yet. The internal `_CreateCogneeProviderSession`
factory supplies `ensureReady()` and `exchange()` to the future request handler. The internal
document and Cognify operations reject duplicate or altered snapshot evidence, nonterminal runs and
receipts that do not echo the saved dataset, operation and digest. A replay of a completed operation
returns the same provider pipeline coordinate. Callers receive projected metadata and failure
classes, never the login token, provider storage path or provider response content.

## Boundary

The gateway app will compose this library. The server uses its separate gateway client, and receives
no Cognee login credential. Saved operation keys, consent, retries and fact metadata stay with the
server's personal-memory domain and existing Absurd workflow engine.

Simultaneous authentication failures share one refresh, and a late failure cannot discard a newer
session. Only a provider 401 permits one replay of the request's saved bytes. A timeout or uncertain
response does not trigger another mutation. Optional first-install registration must be explicitly
enabled; a rejected credential for an existing account remains a readiness failure.

## Dependency direction

Tagged `type:lib`, `layer:infra`, `scope:memory-gateway`. It may depend on its own scope, shared
contracts and workload identity, and cannot import an app, frontend package or backend domain.

## See also

- Parent: [memory gateway](../README.md)
- Server-side client: [memory gateway client](../../server/infra/memory-gateway-client/README.md)
- Personal authority: [personal memory](../../agents/personal/memory/main/README.md)
