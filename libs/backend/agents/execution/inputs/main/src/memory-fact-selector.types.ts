/** One gateway-selected fact reference frozen into the run snapshot; never fact text. */
export interface SelectedMemoryFactReference
{
	/** Stable gateway-minted fact identifier. */
	factId: string;
	/** Canonical lowercase `sha256:<hex>` digest of the fact content held by the gateway. */
	contentDigest: string;
}

/** Coordinates for one admission-time personal-memory fact selection. */
export interface SelectPersonalMemoryFactsInput
{
	/** Silo that owns the memory scope. */
	siloId: string;
	/** Gateway-native Cognee dataset UUID resolved from verified identity. */
	cogneeDatasetId: string;
	/** Verified execution subject whose personal memory is being queried. */
	subjectId: string;
	/** Free-text recall query derived from the frozen conversation context. */
	queryText: string;
	/** Upper bound on the number of fact references to freeze. */
	maxFacts: number;
}

/**
 * Admission-time port that selects personal-memory fact references through the memory gateway.
 *
 * Implementations return references only — fact id and content digest — so no fact text can land
 * in the snapshot or in Postgres. A transport or protocol failure must throw; the scope source
 * fails the admission closed rather than freezing a silently empty selection.
 */
export interface PersonalMemoryFactSelector
{
	/** Selects at most `maxFacts` digested fact references for the verified subject and dataset. */
	select(input: SelectPersonalMemoryFactsInput): Promise<readonly SelectedMemoryFactReference[]>;
}
