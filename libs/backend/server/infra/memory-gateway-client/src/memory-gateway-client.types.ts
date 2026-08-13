/**
 * One fact the memory gateway returned for a recall.
 *
 * Both fields come from the gateway. `factId` is its own identifier and is the ONLY handle a caller
 * may later use to correct or forget the fact — nothing local ever names a fact. Facts arrive in the
 * gateway's own order. Nothing here says which run or agent produced the fact; for that use
 * {@link ScopedMemoryFact}, which carries provenance.
 */
export interface MemoryFact
{
	/** Opaque identifier minted by the gateway; never locally synthesized. */
	readonly factId: string;
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
 * Called by: libs/backend/agents/execution/protocol/src/prisma-run-input-compiler.ts,
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

/**
 * A request to store one fact in a subject's personal memory.
 *
 * Nothing here is derived by the client: the caller supplies the Cognee dataset UUID (OpenCrane's own
 * catalog id never crosses this boundary), the exact text to store, and a delivery key it can repeat
 * safely. No shipped client performs this write yet — both throw `MemoryGatewayUnavailableError` —
 * so treat this as the contract a write-capable gateway must meet.
 *
 * @see {@link PersonalMemoryRecordResult} for the two outcomes a write can have.
 */
export interface PersonalMemoryRecordCommand
{
	/** Silo that owns the personal-memory dataset. */
	readonly siloId: string;
	/** Authenticated subject whose personal memory may receive this fact. */
	readonly subjectId: string;
	/** Cognee dataset UUID; OpenCrane's catalog id never crosses this boundary. */
	readonly cogneeDatasetId: string;
	/** Exact durable fact content, sent only to the remote memory gateway. */
	readonly content: string;
	/**
	 * Key that makes retrying a delivery safe.
	 *
	 * Sending the same key again with byte-identical `content`, for the same subject and dataset, is
	 * allowed and stores nothing new — the result comes back with `idempotent` set. Sending the same
	 * key with DIFFERENT content is refused; see {@link PersonalMemoryRecordDenied}.
	 */
	readonly idempotencyKey: string;
}

/**
 * The outcome of one personal-memory write: either accepted or refused.
 *
 * Callers MUST branch on `outcome`. {@link PersonalMemoryRecorded} means the fact is stored and
 * carries the gateway's own identifier and digest; {@link PersonalMemoryRecordDenied} means nothing
 * was stored because the delivery key was reused with different content. Neither arm throws, so code
 * that assumes success silently loses a refused write.
 */
export type PersonalMemoryRecordResult = PersonalMemoryRecorded | PersonalMemoryRecordDenied;

/** The gateway stored the fact (or found it already stored) and returned its own record of it. */
export interface PersonalMemoryRecorded
{
	/** Always "recorded". This is the tag that tells this arm apart from the refusal. */
	readonly outcome: "recorded";
	/** True when an earlier delivery with the same key had already stored this exact content, so nothing new was written. */
	readonly idempotent: boolean;
	/** The fact's identifier, minted by the gateway. The only handle for a later correction or deletion. */
	readonly cogneeExternalId: string;
	/** Digest of the stored content, always lowercase `sha256:<64 hex chars>`; compare it against your own hash of what you sent. */
	readonly contentDigest: string;
}

/**
 * The gateway refused the write and stored nothing new.
 *
 * This happens when the `idempotencyKey` has already been used for different content in this subject
 * and dataset. Retrying is pointless: either resend the original content under that key, or choose a
 * new key. The fact stored by the first delivery is untouched.
 */
export interface PersonalMemoryRecordDenied
{
	/** Always "denied". This is the tag that tells this arm apart from the acceptance. */
	readonly outcome: "denied";
	/** The only refusal reason: this delivery key was already used for different content. */
	readonly reason: "idempotency_conflict";
}

/** Request to correct the content of one stored fact. */
export interface MemoryCorrectionCommand
{
	/** Silo that owns the memory scope. */
	readonly siloId: string;
	/** Subject whose personal memory is being corrected. */
	readonly subjectId: string;
	/** Gateway-minted fact reference to correct. */
	readonly factId: string;
	/** Replacement content to store for the fact. */
	readonly correctedContent: string;
}

/** Request to forget one stored fact. */
export interface MemoryForgetCommand
{
	/** Silo that owns the memory scope. */
	readonly siloId: string;
	/** Subject whose personal memory is being pruned. */
	readonly subjectId: string;
	/** Gateway-minted fact reference to forget. */
	readonly factId: string;
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
 * NOTE: this is NOT the same type as `MemoryProvenance` in libs/contracts/src/memory.types.ts, which
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
 * Only the two recalls work today. `recordPersonalFact`, `correct`, `forget`, and `injectScoped`
 * throw `MemoryGatewayUnavailableError` in BOTH shipped implementations, because the gateway does not
 * yet own a durable write lifecycle that can be tied back to a remote record. Treat those four as
 * the agreed contract, not as working calls.
 *
 * Two implementations: the HTTP client in http-cognee-memory-gateway-client.ts, and
 * `__UnavailableMemoryGatewayClient`, which refuses everything when no gateway is configured.
 *
 * Called by: libs/backend/agents/execution/protocol/src/prisma-run-input-compiler.ts,
 * gateway-memory-fact-selector.ts, memory-external-action-executor.ts, and
 * external-action-executor.types.ts; composed in
 * apps/opencrane/src/infra/memory/memory-gateway-client.factory.ts.
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
	 * Stores one fact in the authenticated subject's personal memory.
	 *
	 * @param command - Subject, dataset, exact content, and the repeatable delivery key.
	 * @returns Either the gateway's record of the stored fact, or a refusal when the delivery key was
	 *   reused with different content. Branch on `outcome`; a refusal does not throw.
	 * @throws MemoryGatewayUnavailableError Always, in both shipped implementations today.
	 */
	recordPersonalFact(command: PersonalMemoryRecordCommand): Promise<PersonalMemoryRecordResult>;
	/**
	 * Replaces the content of one stored fact.
	 *
	 * @param command - Subject and the gateway-minted `factId`, plus the replacement content.
	 * @throws MemoryGatewayUnavailableError Always, in both shipped implementations today.
	 */
	correct(command: MemoryCorrectionCommand): Promise<void>;
	/**
	 * Deletes one stored fact.
	 *
	 * @param command - Subject and the gateway-minted `factId` to remove.
	 * @throws MemoryGatewayUnavailableError Always, in both shipped implementations today.
	 */
	forget(command: MemoryForgetCommand): Promise<void>;
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
