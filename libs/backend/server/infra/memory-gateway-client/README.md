# @opencrane/backend/server/infra/memory-gateway-client — the personal-memory gateway port

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › memory-gateway-client

## What it owns

This library owns the **boundary for a subject's personal memory**. Every recall names the Cognee
dataset UUID that OpenCrane froze in the admitted run snapshot; a subject id is never
enough to select a dataset. The port still defines recall, record, correction, forgetting, and
scoped operations, but the shipped authenticated transport implements reads only. Writes fail closed
until the gateway owns a recoverable cross-system lifecycle rather than calling Cognee directly.

It is the future transport seam between the personal-agent backend and the private memory gateway:

```
 personal-agent backend  (operations in an admitted personal dataset)
          │  MemoryQueryCommand · PersonalMemoryRecordCommand · MemoryCorrectionCommand · MemoryForgetCommand
          ▼
 ┌────────────────────────────────────┐
 │  memory-gateway-client  ◄── HERE    │  authenticated query/recall; writes fail closed
 └────────────────────────────────────┘
          │  MemoryQueryResult (gateway-minted facts)
          │  write commands currently fail closed
          ▼
 authenticated memory transport boundary
```

**In this flow:** the personal-agent backend *(consumer)* · the authenticated memory transport
boundary *(forwards only authorised reads)* · Cognee *(holds facts and mints fact references)*

It owns: the `MemoryGatewayClient` interface (`query` / `recordPersonalFact` / `correct` / `forget`
for a subject's personal memory, plus `recallScoped` / `injectScoped` for a shared knowledge SCOPE); the request/result
types, where recall returns only gateway-originated facts and a fact reference is only ever real if
the gateway minted it; and a **fail-closed** default implementation,
`__UnavailableMemoryGatewayClient`, which throws `MemoryGatewayUnavailableError` for every call. That
default remains available for non-production composition, while the authenticated transport never
invents an empty recall or a fake write.

A managed agent accesses shared knowledge scopes only through this port. Every scoped write command
still carries mandatory `MemoryProvenance`; the guard runs before the current transport refuses the
write, preserving the contract without pretending that durable injection exists.

### The authenticated Cognee read transport

`__CreateHttpCogneeMemoryGatewayClient` is the authenticated read-transport foundation, composed from `cognee-http.ts`
(projected-token-authenticated, timeout-guarded, 256 KiB-bounded exchanges) and
`cognee-payloads.ts` (defensive response projection). It maps `query` and `recallScoped` onto
`POST /api/v1/search`. `recordPersonalFact`, `correct`, `forget`, and `injectScoped` throw
`MemoryGatewayUnavailableError` without issuing transport.

Scoped recall uses only the Cognee dataset UUID frozen in the admitted run snapshot. Any stored
record whose envelope or provenance fails validation is **dropped** — an
unattributable scoped fact never reaches a managed agent. An unrecognised search response is a
`MemoryGatewayProtocolError`, never a silently empty recall.

When composed, the client presents the OpenCrane server's rotating, audience-bound projected token
to the private memory gateway. Cognee credentials are never mounted in the server; the gateway
TokenReviews the token, accepts only this ServiceAccount, and is the only pod that can reach Cognee. **TODO:** an
authenticated BYO/non-private Cognee transport is not implemented. Failures are bounded —
`MemoryGatewayTransportError` carries only a
`timeout | network | oversize | http_<status>` code.

The client IS composed in production: `apps/opencrane` builds one instance at boot (from
`MEMORY_GATEWAY_URL`, `MEMORY_GATEWAY_TOKEN_PATH`, and `MEMORY_GATEWAY_TIMEOUT_SECONDS`) and shares
it between admission-time fact selection, compile-time digest-verified statement loading, and the
runtime external-action transport. The server chart mounts the audience-bound projected token the
client presents. Mid-run recall through the action executor still waits on an attempt-fenced
ephemeral return channel, and every write path remains fail-closed.

> Cognee's search response shapes are defensively validated. Version drift against the deployed
> image surfaces as a protocol error rather than a wrong answer.

## Public surface

- `MemoryGatewayClient` — the runtime-neutral query/record/correct/forget + recallScoped/injectScoped contract.
- `MemoryQueryCommand`, `MemoryQueryResult`, `MemoryFact`, `MemoryCorrectionCommand`, `MemoryForgetCommand` — the personal-memory I/O types.
- `PersonalMemoryRecordCommand` / `PersonalMemoryRecordResult` — the retained write contract; the
  authenticated transport refuses it until durable delivery and mutation semantics are implemented.
- `__AssertPersonalMemoryRecordResult` / `MemoryGatewayProtocolError` — the future write-response
  guard and the live read-response protocol error.
- `MemoryProvenance`, `ScopedMemoryRecallCommand`, `ScopedMemoryRecallResult`, `ScopedMemoryFact`, `ScopedMemoryInjectionCommand` — the scoped read/write I/O types.
- `__AssertMemoryProvenanceComplete`, `MemoryProvenanceIncompleteError` — the provenance guard and its error.
- `__UnavailableMemoryGatewayClient`, `MemoryGatewayUnavailableError` — the fail-closed default and its error.
- `__CreateHttpCogneeMemoryGatewayClient`, `CogneeMemoryGatewayHttpOptions`, `CogneeFetch` — the authenticated private-gateway transport and its configuration.
- `MemoryGatewayTransportError`, `MemoryGatewayTransportFailureCode` — the bounded failure taxonomy.

## Boundary

The port is consumed by the personal-agent backend, run admission, prompt compilation, and the
external-action executor; the HTTP adapter is composed once per server process. It stores nothing itself and
holds no fact beyond the single in-flight read. Query commands use Cognee's gateway-native dataset
UUID,
while the OpenCrane
memory catalog's internal id stays at the catalog boundary. A runtime supplies that query id only
from its immutable personal-memory policy; no tool argument or subject id may select another
dataset. That prevents a caller from treating an OpenCrane row as proof that the gateway accepted
the fact content.

## Dependency direction

Tagged `scope:memory-gateway-client` (`layer:infra`): it may depend only on
`scope:memory-gateway-client` and `scope:shared` packages — never on backend domains, the frontend,
or app entrypoints.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md)
