import type { MemoryGatewayDatasetCognifyRequest, MemoryGatewayDatasetCognifyResponse, MemoryGatewayDatasetEnsureRequest, MemoryGatewayDatasetEnsureResponse, MemoryGatewayDatasetListRequest, MemoryGatewayDatasetListResponse, MemoryGatewayDocumentAddRequest, MemoryGatewayDocumentAddResponse, MemoryGatewayDocumentDeleteRequest, MemoryGatewayDocumentDeleteResponse, MemoryGatewayDocumentListRequest, MemoryGatewayDocumentListResponse, MemoryGatewayDocumentRawDigestRequest, MemoryGatewayDocumentRawDigestResponse } from "@opencrane/contracts";

/**
 * One fact the memory gateway returned for a recall.
 *
 * Cognee returns one chunk identifier and the separate source-document identifier in every CHUNKS
 * result. The document identifier, together with the admitted dataset, is the mutation coordinate;
 * the chunk identifier identifies only this recalled passage. Facts arrive in the gateway's own
 * order. Nothing here says which run or agent produced the fact; for that use {@link ScopedMemoryFact},
 * which carries provenance.
 */
export interface MemoryFact
{
	/** Cognee Data/document UUID that may later be paired with the admitted dataset for a mutation. */
	readonly cogneeDocumentId: string;
	/** Cognee CHUNKS UUID for this recalled passage; it is never a correction or deletion target. */
	readonly cogneeChunkId: string;
	/** Stored fact text as held by the gateway. */
	readonly content: string;
}

/**
 * A recall against one subject's personal memory.
 *
 * `cogneeDatasetId` is the Cognee dataset UUID frozen into the admitted run snapshot. It is never
 * derived from `subjectId` and never built from a name, so a run can only read the dataset it was
 * admitted for. `maxResults` is a hard ceiling: the adapter passes it to the gateway as `top_k` and
 * truncates again on the way back.
 *
 * Called by: run-input compilation and personal-memory authorities,
 * memory-external-action-executor.ts, and gateway-memory-fact-selector.ts, all through
 * {@link MemoryGatewayClient.query}.
 */
export interface MemoryQueryCommand
{
	/** Silo that owns the memory scope. */
	readonly siloId: string;
	/** Cognee dataset UUID frozen in the admitted run snapshot. */
	readonly cogneeDatasetId: string;
	/** Subject whose personal memory is being queried. */
	readonly subjectId: string;
	/** Free-text recall query. */
	readonly query: string;
	/** Upper bound on the number of facts to return. */
	readonly maxResults: number;
}

/** Facts recalled by the memory gateway for a query. */
export interface MemoryQueryResult
{
	/** Facts the gateway matched, in gateway-defined order. */
	readonly facts: readonly MemoryFact[];
}

/** Authenticated product coordinates retained outside every shared gateway wire body. */
export interface MemoryGatewayOperationContext
{
	/** Silo derived from the authenticated request host. */
	readonly siloId: string;
	/** External subject resolved by the product command owner. */
	readonly subjectId: string;
}

/**
 * Provenance stamped on every record a central agent injects into a shared knowledge scope.
 *
 * A scoped write is only traceable when it names the central agent, the exact revision, the run that
 * produced it, when it was recorded, and the upstream source it came from. All five fields are
 * required; an incomplete provenance fails closed rather than writing a record nobody can attribute.
 * `__AssertMemoryProvenanceComplete` in memory-provenance.ts is where that check happens, and
 * `__DecodeScopedEnvelope` in cognee-payloads.ts re-checks the same five fields on the way back out.
 *
 * NOTE: this is NOT the same type as `MemoryProvenance` in libs/contracts/src/memory/memory.types.ts, which
 * describes stored-fact provenance in the API contract. Import the one that matches the boundary you
 * are working on.
 */
export interface MemoryProvenance
{
	/** Managed agent-service id that produced the record. */
	readonly centralAgentId: string;
	/** Immutable agent revision executing when the record was produced. */
	readonly agentRevisionId: string;
	/** Run id that produced the record. */
	readonly runId: string;
	/** ISO-8601 instant the record was recorded. */
	readonly recordedAt: string;
	/** Opaque reference to the upstream source the record derived from. */
	readonly sourceRef: string;
}

/**
 * A recall against a shared knowledge scope rather than one person's memory.
 *
 * The difference from {@link MemoryQueryCommand} matters: there is no `subjectId`, because the facts
 * belong to a scope many agents may read, and every fact that comes back carries provenance (see
 * {@link ScopedMemoryFact}). Records that cannot prove complete provenance are dropped on the way
 * out, so a result can be shorter than the store actually holds.
 *
 * Called by: no non-test caller in this repo yet; reached through
 * {@link MemoryGatewayClient.recallScoped}.
 */
export interface ScopedMemoryRecallCommand
{
	/** Silo that owns the scope. */
	readonly siloId: string;
	/** Cognee dataset UUID frozen by the caller's admitted scope authority. */
	readonly cogneeDatasetId: string;
	/** Free-text recall query. */
	readonly query: string;
	/** Upper bound on the number of facts to return. */
	readonly maxResults: number;
}

/**
 * A fact recalled from a shared knowledge scope, together with who put it there.
 *
 * The provenance is not decoration: only records that still prove all five provenance fields survive
 * decoding, and `__ParseScopedFacts` in cognee-payloads.ts drops anything else instead of returning
 * it with partial attribution. So every fact in a result is fully attributable, and a short result
 * may mean records were dropped, not that the scope is empty.
 */
export interface ScopedMemoryFact extends MemoryFact
{
	/** Provenance recorded with the fact. */
	readonly provenance: MemoryProvenance;
}

/** Facts recalled from one knowledge scope. */
export interface ScopedMemoryRecallResult
{
	/** Facts the gateway matched, in gateway-defined order. */
	readonly facts: readonly ScopedMemoryFact[];
}

/**
 * A request to write one record into a shared knowledge scope.
 *
 * The provenance is checked before anything else happens: both the HTTP client and the unavailable
 * stub call `__AssertMemoryProvenanceComplete` first, so an unattributable record is refused rather
 * than written. No shipped client performs the write yet — after that check both throw
 * `MemoryGatewayUnavailableError`.
 */
export interface ScopedMemoryInjectionCommand
{
	/** Silo that owns the scope. */
	readonly siloId: string;
	/** Cognee dataset UUID frozen by the caller's admitted scope authority. */
	readonly cogneeDatasetId: string;
	/** Record content to store. */
	readonly content: string;
	/** Mandatory provenance stamped on the injected record. */
	readonly provenance: MemoryProvenance;
}

/**
 * The one way OpenCrane reads and writes memory: a subject's personal memory, and shared knowledge
 * scopes.
 *
 * Personal-memory mutations expose one remote operation per method. The durable workflow chooses
 * the next method from saved state and compares every returned coordinate before it records progress.
 * `injectScoped` remains unavailable until the shared gateway owns that separate write contract.
 *
 * Every mutation failure carries delivery evidence, including transport and protocol errors.
 * `Ambiguous` means the caller must reconcile saved coordinates before another mutation.
 * `ProvenNotSent` permits retrying the unchanged operation after current authority is checked.
 * Neither outcome gives the caller permission to replace the saved operation or its allowance.
 *
 * Two implementations: the HTTP client in http-cognee-memory-gateway-client.ts, and
 * `__UnavailableMemoryGatewayClient`, which refuses everything when no gateway is configured.
 *
 * Called by: run-input compilation and personal-memory authorities,
 * gateway-memory-fact-selector.ts, memory-external-action-executor.ts, and
 * external-action-executor.types.ts; composed in
 * apps/opencrane/src/bootstrap/process/memory-gateway-client.factory.ts.
 */
export interface MemoryGatewayClient
{
	/**
	 * Recalls facts from one subject's personal memory.
	 *
	 * @param command - Silo, frozen Cognee dataset UUID, subject, query text, and result ceiling.
	 * @returns Only gateway-returned facts, at most `maxResults` of them. An empty list means the
	 *   gateway matched nothing — a broken response shape throws instead, so empty is trustworthy.
	 * @throws MemoryGatewayProtocolError When the response shape is unrecognised or is not valid JSON.
	 * @throws MemoryGatewayTransportError When the gateway cannot be reached, times out, answers
	 *   non-2xx, or exceeds the response ceiling.
	 * @throws MemoryGatewayUnavailableError When no gateway is configured.
	 */
	query(command: MemoryQueryCommand): Promise<MemoryQueryResult>;
	/**
	 * Ensures the dataset identified by an already saved opaque name.
	 *
	 * @param context - Authenticated silo and subject, retained outside the shared wire request.
	 * @param request - Exact dataset name derived from the saved local dataset identity.
	 * @returns Provider dataset identity; it does not activate the local dataset.
	 * @throws MemoryGatewayMutationFailure When the gateway refuses the mutation with delivery evidence.
	 * @throws MemoryGatewayTransportError When the exchange fails; inspect its delivery state before retrying.
	 * @throws MemoryGatewayProtocolError When the request or receipt is invalid; an ambiguous receipt requires reconciliation.
	 */
	ensureDataset(context: MemoryGatewayOperationContext, request: MemoryGatewayDatasetEnsureRequest): Promise<MemoryGatewayDatasetEnsureResponse>;
	/**
	 * Lists the provider dataset matching one already saved opaque name.
	 *
	 * @param context - Authenticated silo and subject, retained outside the shared wire request.
	 * @param request - Exact opaque dataset name to recover.
	 * @returns Zero or one exact-name dataset.
	 */
	listDatasets(context: MemoryGatewayOperationContext, request: MemoryGatewayDatasetListRequest): Promise<MemoryGatewayDatasetListResponse>;
	/**
	 * Adds one digest-bound text document to an exact provider dataset.
	 *
	 * @param context - Authenticated silo and subject, retained outside the shared wire request.
	 * @param request - Dataset, complete text, and its caller-saved digest.
	 * @returns Exact dataset, document, and complete-content digest evidence.
	 * @throws MemoryGatewayMutationFailure When the gateway refuses the mutation with delivery evidence.
	 * @throws MemoryGatewayTransportError When the exchange fails; inspect its delivery state before retrying.
	 * @throws MemoryGatewayProtocolError When the request or receipt is invalid; an ambiguous receipt requires reconciliation.
	 */
	addDocument(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentAddRequest): Promise<MemoryGatewayDocumentAddResponse>;
	/**
	 * Lists the metadata-only document snapshot for one exact dataset.
	 *
	 * @param context - Authenticated silo and subject, retained outside the shared wire request.
	 * @param request - Exact provider dataset to inspect.
	 * @returns Dataset-bound document identities, digests, media types, and byte lengths.
	 */
	listDocuments(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentListRequest): Promise<MemoryGatewayDocumentListResponse>;
	/**
	 * Reads complete-byte digest evidence for one exact dataset document.
	 *
	 * @param context - Authenticated silo and subject, retained outside the shared wire request.
	 * @param request - Exact provider dataset and document to inspect.
	 * @returns The gateway's digest and byte-length evidence for those same coordinates.
	 */
	readDocumentDigest(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentRawDigestRequest): Promise<MemoryGatewayDocumentRawDigestResponse>;
	/**
	 * Runs or replays one saved blocking indexing operation.
	 *
	 * @param context - Authenticated silo and subject, retained outside the shared wire request.
	 * @param request - Dataset, stable operation id, and expected input-evidence digest.
	 * @returns Pipeline evidence bound to the same dataset, operation, and digest.
	 * @throws MemoryGatewayMutationFailure When the gateway refuses the mutation with delivery evidence.
	 * @throws MemoryGatewayTransportError When the exchange fails; inspect its delivery state before retrying.
	 * @throws MemoryGatewayProtocolError When the request or receipt is invalid; an ambiguous receipt requires reconciliation.
	 */
	cognifyDataset(context: MemoryGatewayOperationContext, request: MemoryGatewayDatasetCognifyRequest): Promise<MemoryGatewayDatasetCognifyResponse>;
	/**
	 * Deletes one exact dataset document and returns the gateway's absence proof.
	 *
	 * @param context - Authenticated silo and subject, retained outside the shared wire request.
	 * @param request - Exact provider dataset and document to delete.
	 * @returns A typed receipt echoing the deleted coordinates.
	 * @throws MemoryGatewayMutationFailure When the gateway refuses the mutation with delivery evidence.
	 * @throws MemoryGatewayTransportError When the exchange fails; inspect its delivery state before retrying.
	 * @throws MemoryGatewayProtocolError When the request or receipt is invalid; an ambiguous receipt requires reconciliation.
	 */
	deleteDocument(context: MemoryGatewayOperationContext, request: MemoryGatewayDocumentDeleteRequest): Promise<MemoryGatewayDocumentDeleteResponse>;
	/**
	 * Recalls facts from a shared knowledge scope, each with the provenance stamped when it was written.
	 *
	 * @param command - Silo, frozen dataset UUID, query text, and result ceiling.
	 * @returns Only facts that still prove complete provenance; unattributable records are dropped, so
	 *   a short result does not mean the scope is nearly empty.
	 * @throws MemoryGatewayProtocolError When the response shape is unrecognised or is not valid JSON.
	 * @throws MemoryGatewayTransportError For any transport failure.
	 * @throws MemoryGatewayUnavailableError When no gateway is configured.
	 */
	recallScoped(command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>;
	/**
	 * Writes one record into a shared knowledge scope.
	 *
	 * @param command - Silo, frozen dataset UUID, the content, and the mandatory provenance.
	 * @throws MemoryProvenanceIncompleteError When any provenance field is missing, blank, or (for
	 *   `recordedAt`) not a parseable date. Checked first, before anything else.
	 * @throws MemoryGatewayUnavailableError After that check passes, in both shipped implementations
	 *   today.
	 */
	injectScoped(command: ScopedMemoryInjectionCommand): Promise<void>;
}
