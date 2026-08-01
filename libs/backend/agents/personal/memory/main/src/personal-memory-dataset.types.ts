/** Proof-bound coordinates used to resolve one personal memory dataset. */
export interface ResolvePersonalMemoryDatasetCommand
{
	/** Silo in which the personal dataset must exist. */
	readonly siloId: string;
	/** Organization from the verified fleet-membership assertion. */
	readonly organizationId: string;
	/** Subject whose personal dataset is being resolved. */
	readonly subjectId: string;
}

/** Active personal dataset selected from proof-bound identity rather than caller-supplied dataset input. */
export interface PersonalMemoryDataset
{
	/** OpenCrane catalog identifier used for durable fact provenance. */
	readonly datasetId: string;
	/** Cognee identifier used only by the memory-gateway boundary. */
	readonly cogneeDatasetId: string;
}

/** Persistence boundary for resolving the one active personal dataset under exact identity coordinates. */
export interface PersonalMemoryDatasetRepository
{
	/** Finds the active personal dataset for the exact silo, organization, and subject, or none. */
	findActivePersonalDataset(command: ResolvePersonalMemoryDatasetCommand): Promise<PersonalMemoryDataset | null>;
}

/** Stable outcome from resolving personal memory without accepting a caller-selected dataset. */
export type ResolvePersonalMemoryDatasetResult = { readonly outcome: "resolved"; readonly dataset: PersonalMemoryDataset } | { readonly outcome: "denied"; readonly reason: "memory_scope_unavailable" };
