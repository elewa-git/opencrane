/**
 * `@opencrane/backend/server/infra/memory-gateway-client` — the OpenCrane server's only client for
 * agent memory: one subject's personal memory, and shared knowledge scopes.
 *
 * Everything goes through the `MemoryGatewayClient` port. Cognee sits behind the in-cluster memory
 * gateway, which checks the server's projected ServiceAccount token, so nothing here talks to Cognee
 * directly. Two rules run through the whole package. Recall never degrades: an unrecognised response
 * is a protocol failure, not an empty result. And attribution is all-or-nothing: a scoped record
 * that cannot prove complete provenance is dropped rather than returned with partial attribution,
 * and a scoped write without complete provenance is refused before it is sent.
 *
 * Personal-memory writes expose one remote operation per method so the durable workflow remains
 * the sole sequencing and recovery owner. Scoped injection stays fail closed.
 */
export { __UnavailableMemoryGatewayClient, MemoryGatewayUnavailableError } from "./unavailable-memory-gateway-client";
export { __AssertMemoryProvenanceComplete, MemoryProvenanceIncompleteError } from "./memory-provenance";
export { MemoryGatewayMutationFailure, MemoryGatewayProtocolError, MemoryGatewayReadFailure, MemoryGatewayTransportError } from "./memory-gateway-errors";
export { __CreateHttpCogneeMemoryGatewayClient } from "./http-cognee-memory-gateway-client";
export type { CogneeFetch, CogneeMemoryGatewayHttpOptions, MemoryGatewayTransportFailureCode } from "./http-cognee-memory-gateway-client.types";
export type { MemoryFact, MemoryGatewayClient, MemoryGatewayOperationContext, MemoryProvenance, MemoryQueryCommand, MemoryQueryResult, ScopedMemoryFact, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types";
