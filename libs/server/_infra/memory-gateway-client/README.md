# @opencrane/server/_infra/memory-gateway-client — the memory gateway port

> [server](../../README.md) › [_infra](../README.md) › memory-gateway-client

## What it owns

This library owns the **boundary for personal and attached scoped memory** — personal recall,
retention, correction, and forgetting plus provenance-validated shared recall and injection through
the memory gateway instead of calling Cognee directly. Attached recall names the complete
gateway-native dataset set that OpenCrane froze in the admitted run snapshot; a subject id is never
enough to select a dataset. The *memory
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

### The real Cognee transport

`__CreateHttpCogneeMemoryGatewayClient` is the production client, composed from `cognee-http.ts`
(projected-token-authenticated, timeout-guarded, 256 KiB-bounded exchanges) and `cognee-payloads.ts` (response
projection and scoped envelopes). It maps the port onto Cognee's REST API — `POST /api/v1/search`
for recall, `POST /api/v1/add` + `POST /api/v1/cognify` for writes, and
`DELETE /api/v1/datasets/{dataset}/data/{factId}` for correction and forgetting.

Cognee supplies neither idempotency nor fact-to-dataset resolution, so the client depends on a
**`PersonalMemoryDeliveryLedger`** port — defined here, implemented with Prisma in the composition
root so this library keeps no database dependency. `recordPersonalFact` consults the ledger first: a
known key with an identical content digest returns `idempotent: true` **with no remote write at
all**, a known key with different content returns the explicit `idempotency_conflict` denial, and a
fresh key writes remotely and then binds the evidence. A crash between those two steps leaves an
orphan Cognee item but never fabricated idempotency evidence. Indexing (`cognify`) is best effort:
it cannot turn a durably accepted write into a failure the caller would retry.

Scoped knowledge uses gateway dataset identifiers resolved from OpenCrane's memory catalogue, and
each record is stored as a `{ v, content, provenance }` envelope so attribution survives the round
trip. One scoped recall can
search the complete frozen dataset set in a single Cognee request. On recall, any record
whose envelope or provenance fails validation is **dropped** — an unattributable scoped fact never
reaches a managed agent. An unrecognised search response is a `MemoryGatewayProtocolError`, never a
silently empty recall.

The client presents the OpenCrane server's rotating, audience-bound projected token to the private
memory gateway. Cognee credentials are never mounted in the server; the gateway TokenReviews the
token, accepts only this ServiceAccount, and is the only pod that can reach Cognee. **TODO:** an
authenticated BYO/non-private Cognee transport is not implemented. Failures are bounded —
`MemoryGatewayTransportError` carries only a
`timeout | network | oversize | http_<status>` code.

> Cognee's API shapes were taken from the current published reference. Version drift against the
> deployed 1.2.1 image is qualified at deploy time; every response is defensively validated, so a
> contract change surfaces as a protocol error rather than a wrong answer.

Absent `MEMORY_GATEWAY_URL` or `MEMORY_GATEWAY_TOKEN_FILE`, the composition root keeps the fail-closed stub.

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
- `__CreateHttpCogneeMemoryGatewayClient`, `CogneeMemoryGatewayHttpOptions`, `CogneeFetch` — the authenticated private-gateway transport and its configuration.
- `PersonalMemoryDeliveryLedger`, `PersonalMemoryDeliveryKey`, `PersonalMemoryDeliveryRecord` — the durable idempotency/resolution port the transport requires.
- `MemoryGatewayTransportError`, `MemoryGatewayRemoteRefusalError`, `MemoryGatewayTransportFailureCode` — the bounded failure taxonomy.

## Boundary

Consumed by the personal-agent backend and the external-action executor. It stores nothing itself and
holds no fact beyond the single in-flight call: durable state lives in Cognee (fact content) and in
the delivery ledger the composition root implements (replay evidence). In particular, record and
query commands use the gateway-native dataset id, while the OpenCrane
memory catalog's internal id stays at the catalog boundary. A runtime supplies those query ids only
from its immutable personal or attached-scope policy; no tool argument or subject id may select
another dataset. That prevents a caller from treating an OpenCrane row as proof that the gateway
accepted the fact content.

## Dependency direction

Tagged `scope:memory-gateway-client` (`layer:infra`): it may depend only on
`scope:memory-gateway-client` and `scope:shared` packages — never on backend domains, the frontend,
or app entrypoints.

## See also

- Parent index: [_infra](../README.md) · [server libraries](../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md) · [obot-custody](../obot-custody/README.md)
