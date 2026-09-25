# @opencrane/backend/server/infra/memory-gateway-client — the personal-memory gateway port

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › memory-gateway-client

## What it owns

This library is the server's only port to the private memory gateway. It keeps the existing personal
and scoped recall projections and exposes the gateway's stable dataset, document, digest, indexing,
and deletion operations as individual steps. Cognee stays behind the gateway; this package never
contacts it directly.

```
 durable memory workflow
          │  one saved step and its exact shared request
          ▼
 ┌────────────────────────────────────┐
 │  memory-gateway-client  ◄── HERE    │  one authenticated HTTP exchange
 └────────────────────────────────────┘
          │  validated coordinates and evidence
          ▼
 private memory gateway ──► Cognee
```

The workflow owns the operation sequence, operation keys, retry decisions, conflict resolution,
and durable recovery. Each method here performs exactly one remote operation and never retries a
mutation. The `MemoryGatewayOperationContext` carries the product's authenticated silo and subject
outside the shared gateway wire body. Those coordinates are validated locally and are never added
to a provider request.

The query methods require the gateway-native dataset UUID frozen in the admitted run snapshot. A
subject id alone never selects a dataset. Search uses `POST /api/v1/memory/search`; the superseded
`/api/v1/search` path is not supported. Personal query returns gateway facts with separate document
and chunk identifiers. Scoped recall also validates and projects stored provenance, dropping any
record that cannot prove complete attribution.

## Stable operations

The port exposes these one-call operations with request and response DTOs from
`@opencrane/contracts`:

- `ensureDataset` and `listDatasets` establish or recover one opaque dataset name.
- `addDocument`, `listDocuments`, and `readDocumentDigest` establish or recover exact document and
  content-digest evidence.
- `cognifyDataset` executes or recovers one saved indexing operation and binds the response to its
  operation id and input-evidence digest.
- `deleteDocument` deletes one exact dataset document and returns the gateway's typed absence
  receipt.

Every response is schema-validated and then checked against the request's dataset, document,
operation, or digest coordinates. A mismatch is a protocol failure; it is never returned as useful
evidence. The previous high-level record, correct, and forget methods are gone because sequencing
those lifecycles in a transport client created a second workflow authority.

`injectScoped` remains fail closed until a separate shared-scope write contract is implemented. It
still validates mandatory provenance before returning an unavailable failure.

## Authentication and failures

`__CreateHttpCogneeMemoryGatewayClient` accepts only a release-local HTTP Service origin under
`.svc.cluster.local`. It rereads the projected ServiceAccount token for every exchange, refuses
redirects, keeps the timeout active while consuming the response, and limits a complete response to
8 MiB. Tokens, fact content, request bodies, URLs, response bodies, and underlying causes are not
placed in errors.

Read failures use `MemoryGatewayReadFailure` and carry no mutation-delivery claim. Mutation failures
use `MemoryGatewayMutationFailure` and always carry `ProvenNotSent` or `Ambiguous`. Local validation,
token-read failure, and serialization failure before `fetch` are `ProvenNotSent`. Network, timeout,
malformed response, and coordinate mismatch after dispatch are `Ambiguous`. Strict gateway error
envelopes retain the delivery state supplied by the gateway. The adapter does not turn an ambiguous
failure into a retry.

`__UnavailableMemoryGatewayClient` preserves the same split: reads fail as unavailable reads, while
mutations fail as `ProvenNotSent`. It never returns an empty result or fabricated receipt.

## Public surface

- `MemoryGatewayClient`, `MemoryGatewayOperationContext`, `MemoryQueryCommand`, and
  `MemoryQueryResult` define the personal-memory port and its query projection.
- `MemoryProvenance`, `ScopedMemoryRecallCommand`, `ScopedMemoryRecallResult`,
  `ScopedMemoryFact`, and `ScopedMemoryInjectionCommand` preserve the scoped-memory contract.
- `__CreateHttpCogneeMemoryGatewayClient`, `CogneeMemoryGatewayHttpOptions`, and `CogneeFetch`
  compose the authenticated private-gateway transport.
- `MemoryGatewayReadFailure`, `MemoryGatewayMutationFailure`, `MemoryGatewayProtocolError`, and
  `MemoryGatewayTransportError` expose the bounded failure taxonomy.
- `__UnavailableMemoryGatewayClient` and `MemoryGatewayUnavailableError` provide the fail-closed
  composition used when no gateway is configured.

The shared operation request and response DTOs remain owned and exported by
`@opencrane/contracts`; this package consumes them rather than defining parallel wire types.

## Boundary

The client is composed once in `apps/opencrane` from `MEMORY_GATEWAY_URL`,
`MEMORY_GATEWAY_TOKEN_PATH`, and `MEMORY_GATEWAY_TIMEOUT_SECONDS`. It stores no fact, receipt,
workflow state, token, or retry state. Run admission, prompt compilation, durable personal-memory
workflows, and the runtime action executor consume the port. The gateway remains the sole in-cluster
owner of Cognee provider access.

## Dependency direction

Tagged `scope:memory-gateway-client` (`layer:infra`): this package depends only on the shared
contracts, observability, and its own source. It never imports a backend domain, frontend package,
or application entrypoint.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [api](../api/README.md) · [auth](../auth/README.md) · [http](../http/README.md)
