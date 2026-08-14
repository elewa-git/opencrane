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
 * Only the two recalls are implemented today. The write methods throw
 * `MemoryGatewayUnavailableError` in both shipped implementations.
 */
export { __UnavailableMemoryGatewayClient, MemoryGatewayUnavailableError } from "./unavailable-memory-gateway-client";
export { __AssertMemoryProvenanceComplete, MemoryProvenanceIncompleteError } from "./memory-provenance";
export { __AssertPersonalMemoryRecordResult, MemoryGatewayProtocolError } from "./personal-memory-record";
export { __CreateHttpCogneeMemoryGatewayClient } from "./http-cognee-memory-gateway-client";
export { MemoryGatewayTransportError } from "./cognee-http";
export type { CogneeFetch, CogneeMemoryGatewayHttpOptions, MemoryGatewayTransportFailureCode } from "./http-cognee-memory-gateway-client.types";
export type { MemoryCorrectionCommand, MemoryFact, MemoryForgetCommand, MemoryGatewayClient, MemoryProvenance, MemoryQueryCommand, MemoryQueryResult, PersonalMemoryRecordCommand, PersonalMemoryRecordDenied, PersonalMemoryRecorded, PersonalMemoryRecordResult, ScopedMemoryFact, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types";
