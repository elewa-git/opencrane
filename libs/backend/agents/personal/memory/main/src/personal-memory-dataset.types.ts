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

/** Persistence boundary for verified personal dataset and preference-fact selection. */
export interface PersonalMemoryAdmissionRepository
{
	/** Finds the active personal dataset for the exact silo, organization, and subject, or none. */
	findActivePersonalDataset(command: ResolvePersonalMemoryDatasetCommand): Promise<PersonalMemoryDataset | null>;
	/** Selects consented explicit preference facts for the exact verified personal identity. */
	findActivePreferenceFactIds(command: ResolvePersonalMemoryDatasetCommand): Promise<readonly string[]>;
}

/** Stable result vocabulary for identity-bound personal dataset selection. */
export enum PersonalMemoryDatasetResolutionOutcomes
{
	/** A valid active personal dataset was resolved from verified identity coordinates. */
	Resolved = "resolved",
	/** Identity evidence or an active personal dataset was unavailable. */
	Denied = "denied",
}

/**
 * Stable, fail-closed reasons returned when verified identity cannot select personal memory.
 *
 * These values are serialized with the resolution result so run assembly, API consumers, and
 * audit evidence retain one vocabulary without granting a caller the ability to choose a dataset.
 */
export enum PersonalMemoryDatasetResolutionDenialReasons
{
	/**
	 * The signed personal identity was incomplete, had no active dataset, or resolved corrupt coordinates.
	 *
	 * This reason discloses no existence detail about a dataset in another personal-memory scope.
	 */
	MemoryScopeUnavailable = "memory_scope_unavailable",
}

/** Stable outcome from resolving personal memory without accepting a caller-selected dataset. */
export type ResolvePersonalMemoryDatasetResult = { readonly outcome: PersonalMemoryDatasetResolutionOutcomes.Resolved; readonly dataset: PersonalMemoryDataset } | { readonly outcome: PersonalMemoryDatasetResolutionOutcomes.Denied; readonly reason: PersonalMemoryDatasetResolutionDenialReasons.MemoryScopeUnavailable };
