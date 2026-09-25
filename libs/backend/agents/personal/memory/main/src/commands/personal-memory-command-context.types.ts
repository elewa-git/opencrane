/**
 * Public domain states mapped from PostgreSQL dataset states by the repository.
 * Renaming these values changes the domain contract; it does not rename stored database states.
 * Retired datasets remain unavailable to command admission. A state alone grants no access.
 */
export enum PersonalMemoryCommandDatasetStates
{
	/** The local dataset exists but has not adopted a provider UUID. */
	Provisioning = "provisioning",
	/** The local dataset has an adopted provider UUID and can admit existing-dataset work. */
	Active = "active",
	/** The local dataset remains visible so callers fail closed instead of replacing it. */
	Retired = "retired",
}

/**
 * Public domain states mapped from PostgreSQL fact states while a command resolves its target.
 * These values are separate from the stored state names. Forgotten records represent completed
 * deletion, while Corrected records may still require Forget; neither state grants mutation access.
 */
export enum PersonalMemoryCommandFactStates
{
	/** The fact is currently recallable. */
	Active = "active",
	/** A successor replaced the fact while preserving its correction history. */
	Corrected = "corrected",
	/** Forget admission hid the fact while provider deletion is pending. */
	ForgetPending = "forget_pending",
	/** Provider deletion and catalog finalization completed. */
	Forgotten = "forgotten",
}

/** Personal boundary selected from the authenticated caller, never from a command body. */
export interface PersonalMemoryCommandContextCoordinates
{
	/** Silo selected by the authenticated request host. */
	readonly siloId: string;
	/** Verified local Principal that owns this personal scope. */
	readonly principalId: string;
}

/** Dataset metadata used by command composition before the operation takes its locks. */
export interface PersonalMemoryCommandDataset
{
	/** Immutable local dataset identifier. */
	readonly id: string;
	/** Current lifecycle; a retired dataset cannot admit more work. */
	readonly state: PersonalMemoryCommandDatasetStates;
	/** Adopted provider UUID, or null while provisioning is incomplete. */
	readonly cogneeDatasetId: string | null;
}

/** Exact target metadata for Correct or Forget; it confers no permission to mutate the fact. */
export interface PersonalMemoryCommandTargetFact
{
	/** Local fact identifier scoped to the selected personal dataset. */
	readonly id: string;
	/** Exact provider document retained for replacement or deletion. */
	readonly cogneeExternalId: string;
	/** Current revision; fresh admission checks it again under the fact lock. */
	readonly revision: number;
	/** Current fact lifecycle; replay retains its originally admitted revision. */
	readonly state: PersonalMemoryCommandFactStates;
}

/** Transaction-bound domain metadata used by authenticated command composition. */
export interface PersonalMemoryCommandContextRepository
{
	/** Finds the exact personal dataset, including retired state so creation cannot replace it. */
	findDataset(coordinates: PersonalMemoryCommandContextCoordinates): Promise<PersonalMemoryCommandDataset | null>;
	/** Creates only after collection Create was admitted by the same transaction. */
	createDataset(coordinates: PersonalMemoryCommandContextCoordinates, datasetId: string, now: Date): Promise<PersonalMemoryCommandDataset>;
	/** Reads a fact within the actor-owned dataset; fresh admission must still lock and validate it. */
	findTarget(datasetId: string, factId: string): Promise<PersonalMemoryCommandTargetFact | null>;
}
