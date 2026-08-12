/** Points at one fact the memory gateway picked. The snapshot stores this reference only, never the fact text. */
export interface SelectedMemoryFactReference
{
	/** Stable gateway-minted fact identifier. */
	factId: string;
	/** Canonical lowercase `sha256:<hex>` digest of the fact content held by the gateway. */
	contentDigest: string;
}

/** Inputs for one personal-memory fact lookup, made while a run is being admitted. */
export interface SelectPersonalMemoryFactsInput
{
	/** Silo that owns the memory scope. */
	siloId: string;
	/**
	 * The Cognee dataset UUID the memory gateway uses, worked out from the verified identity.
	 *
	 * Cognee is the third-party knowledge store behind the gateway; a dataset is its per-subject
	 * partition, and this UUID is Cognee's own id for it, not an OpenCrane id. It is resolved from the
	 * verified identity so a request can never name another subject's dataset.
	 */
	cogneeDatasetId: string;
	/** Verified execution subject whose personal memory is being queried. */
	subjectId: string;
	/** Free-text recall query derived from the frozen conversation context. */
	queryText: string;
	/** Upper bound on the number of fact references to freeze. */
	maxFacts: number;
}

/**
 * Picks personal-memory fact references through the memory gateway while a run is being admitted.
 *
 * Implementations return references only — fact id and content digest — so no fact text can land
 * in the snapshot or in Postgres.
 *
 * Failure contract, and it is the opposite of the usual one: a transport or protocol failure MUST
 * throw. {@link PersonalMemoryScopeSource} catches that and refuses the admission with
 * `memory_unavailable`. An implementation that swallowed the error and returned an empty array
 * instead would produce a run that looks like "this user has no memories", and nothing downstream
 * could tell the difference.
 *
 * Implemented by: `GatewayMemoryFactSelector`
 * (execution/protocol/src/gateway-memory-fact-selector.ts). Supplied by the app at
 * apps/opencrane/src/index.ts and passed through `__CreatePersonalRunAdmissionPort`.
 */
export interface PersonalMemoryFactSelector
{
	/**
	 * Selects at most `input.maxFacts` digested fact references for the verified subject and dataset.
	 *
	 * @param input - Dataset, subject, query text, and cap. All of it is server-derived; none of it
	 * may come from a request body.
	 * @returns Fact ids with content digests, sorted by fact id so the frozen order does not depend on
	 * recall ranking. An empty array is a valid answer and means "no matching facts".
	 * @throws On any transport or protocol failure. Do not return an empty array instead — see the
	 * failure contract on this interface.
	 */
	select(input: SelectPersonalMemoryFactsInput): Promise<readonly SelectedMemoryFactReference[]>;
}
