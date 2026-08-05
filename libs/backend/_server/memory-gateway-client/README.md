# @opencrane/backend/_server/memory-gateway-client — the personal-memory gateway port

> [backend](../../README.md) › [_server](../README.md) › memory-gateway-client

## What it owns

This library owns the **boundary for a subject's personal memory** — recalling, correcting, and
forgetting stored facts through the memory gateway instead of calling Cognee directly. A recall also
names the gateway-native dataset that OpenCrane froze in the admitted run snapshot; a subject id is
never enough to select a dataset. The *memory
gateway* is the green-side authority that fronts org/personal memory; routing every read and write
through this port is what lets the platform stop reaching into Cognee from scattered call sites (see
the org-memory wiring notes). This package is a **port** — a runtime-neutral contract (a TypeScript
interface) that says *what* memory operations exist, with the real transport wired in elsewhere.

It sits between the personal-agent backend and the remote memory gateway:

```
 personal-agent backend  (recall / record / correct / forget in an admitted personal dataset)
          │  MemoryQueryCommand · PersonalMemoryRecordCommand · MemoryCorrectionCommand · MemoryForgetCommand
          ▼
 ┌────────────────────────────────────┐
 │  memory-gateway-client  ◄── HERE    │  MemoryGatewayClient: query · record · correct · forget
 └────────────────────────────────────┘
          │  MemoryQueryResult (gateway-minted facts)
          │  PersonalMemoryRecordResult (gateway id + sha256: digest / idempotency conflict)
          ▼
 remote memory gateway authority
```

**In this flow:** the personal-agent backend *(consumer)* · the remote memory gateway *(holds the
facts, mints fact references)*

It owns: the `MemoryGatewayClient` interface (`query` / `recordPersonalFact` / `correct` / `forget`
for a subject's personal memory, plus `recallScoped` / `injectScoped` for a shared knowledge SCOPE); the request/result
types, where recall returns only gateway-originated facts and a fact reference is only ever real if
the gateway minted it; and a **fail-closed** default implementation,
`__UnavailableMemoryGatewayClient`, which throws `MemoryGatewayUnavailableError` for every call. That
default ships until an authenticated memory-gateway transport is verified, so no code path can invent
an empty recall or a fake write in the meantime.

A managed agent reads and writes shared knowledge scopes ONLY through this port (never Cognee
directly), and every scoped write carries mandatory `MemoryProvenance` — the central-agent id, the
revision, the run id, the timestamp, and the source reference. `__AssertMemoryProvenanceComplete`
enforces this before any transport, so an unattributable record fails closed with
`MemoryProvenanceIncompleteError` rather than being written. Invariant: absent a working transport
the answer is a hard failure, not a placeholder result; and no scoped record is ever injected without
complete provenance.

## Public surface

- `MemoryGatewayClient` — the runtime-neutral query/record/correct/forget + recallScoped/injectScoped contract.
- `MemoryQueryCommand`, `MemoryQueryResult`, `MemoryFact`, `MemoryCorrectionCommand`, `MemoryForgetCommand` — the personal-memory I/O types.
- `PersonalMemoryRecordCommand` / `PersonalMemoryRecordResult` — authenticated personal-memory retention:
  the gateway receives the fact text and returns its own external id and SHA-256 digest only after
  durable acceptance. The digest is always a lowercase `sha256:` content address; a reused key with
  different content returns the explicit `idempotency_conflict` denial instead of silently reusing a
  fact for the wrong statement.
- `__AssertPersonalMemoryRecordResult` / `MemoryGatewayProtocolError` — response guard that every
  concrete transport uses before exposing record evidence to the catalog boundary.
- `MemoryProvenance`, `ScopedMemoryRecallCommand`, `ScopedMemoryRecallResult`, `ScopedMemoryFact`, `ScopedMemoryInjectionCommand` — the scoped read/write I/O types.
- `__AssertMemoryProvenanceComplete`, `MemoryProvenanceIncompleteError` — the provenance guard and its error.
- `__UnavailableMemoryGatewayClient`, `MemoryGatewayUnavailableError` — the fail-closed default and its error.

## Boundary

Consumed by the personal-agent backend. It defines the memory contract and a safe default; it does
not talk to the gateway or Cognee itself yet — a concrete, authenticated client is wired when the
gateway API contract is confirmed. It stores nothing and holds no fact beyond the single in-flight
call. In particular, record and query commands use the gateway-native dataset id, while the OpenCrane
memory catalog's internal id stays at the catalog boundary. A runtime supplies that query id only
from its immutable personal-memory policy; no tool argument or subject id may select another
dataset. That prevents a caller from treating an OpenCrane row as proof that the gateway accepted
the fact content.

## Dependency direction

Tagged `scope:memory-gateway-client` (`layer:infra`): it may depend only on
`scope:memory-gateway-client` and `scope:shared` packages — never on backend domains, the frontend,
or app entrypoints.

## See also

- Parent index: [_server](../README.md) · [backend libraries](../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md) · [obot-custody](../obot-custody/README.md)
