/**
 * The three verified identity fields that select one user's personal memory dataset.
 *
 * Every field must come from a verified identity, never from request input. There is
 * deliberately no dataset id here: a caller naming its own dataset is how one user's memory
 * would be read into another user's run.
 *
 * @see {@link PersonalMemoryAdmissionRepository} for the lookups that take this shape.
 */
export interface ResolvePersonalMemoryDatasetCommand
{
	/** Silo in which the personal dataset must exist. */
	readonly siloId: string;
	/** Organization taken from the caller's verified membership. */
	readonly organizationId: string;
	/** Subject whose personal dataset is being resolved. */
	readonly subjectId: string;
}

/**
 * One user's active personal memory dataset, found from their verified identity.
 *
 * Carries two ids on purpose: `datasetId` is OpenCrane's own catalog id, recorded against
 * durable facts; `cogneeDatasetId` is Cognee's id and must not travel past the memory gateway.
 * Only a dataset in the Active state is ever returned.
 */
export interface PersonalMemoryDataset
{
	/** OpenCrane catalog identifier used for durable fact provenance. */
	readonly datasetId: string;
	/** Cognee identifier used only by the memory-gateway boundary. */
	readonly cogneeDatasetId: string;
}

/**
 * Reads a user's personal dataset and preference facts during run admission.
 *
 * Implementations run inside the admission transaction the caller already opened, so both
 * reads are frozen together with the run's input snapshot. They must add no filter of their
 * own beyond the command's three identity fields, and must never accept a dataset id.
 *
 * Called by: {@link __ResolvePersonalMemoryDataset} and
 * {@link __SelectPersonalPreferenceFactIds}; supplied by `_CreatePersonalMemory` in
 * libs/backend/agents/execution/inputs/main/src/prisma-session-assembly-authorities.ts.
 *
 * @see {@link PrismaPersonalMemoryAdmissionRepository} for the only implementation.
 */
export interface PersonalMemoryAdmissionRepository
{
	/**
	 * @param command - The three verified identity fields; all must match.
	 * @returns The user's Active personal dataset, or null when no Active dataset matches all
	 * three. Null must not be reported as an error to the user: it is turned into the single
	 * vague `MemoryScopeUnavailable` denial so it cannot be used to probe for other users' scopes.
	 */
	findActivePersonalDataset(command: ResolvePersonalMemoryDatasetCommand): Promise<PersonalMemoryDataset | null>;
	/**
	 * @param command - The three verified identity fields; all must match.
	 * @returns The ids of the user's Active facts whose consent is Explicit or Confirmed and
	 * whose provenance names this same user as having stated them. Facts derived from messages,
	 * and facts stated by anyone else, are excluded. Empty when the user has no personal dataset.
	 */
	findActivePreferenceFactIds(command: ResolvePersonalMemoryDatasetCommand): Promise<readonly string[]>;
}

/**
 * Whether the personal dataset lookup found a dataset.
 *
 * `Resolved` carries the dataset; `Denied` carries the one denial reason. There is no third
 * outcome, and no outcome that distinguishes "no such dataset" from "identity was incomplete".
 */
export enum PersonalMemoryDatasetResolutionOutcomes
{
	/** A valid active personal dataset was resolved from verified identity coordinates. */
	Resolved = "resolved",
	/** Identity evidence or an active personal dataset was unavailable. */
	Denied = "denied",
}

/**
 * Why a personal memory lookup was refused. There is deliberately only one reason.
 *
 * An incomplete identity, a user with no Active dataset, and a malformed row all return the
 * same value, so no caller can tell those cases apart, and no caller can learn whether another
 * user's dataset exists by comparing refusals.
 *
 * The string goes out with the result, so run assembly, API clients and audit records all use
 * the same wording. It is part of the API — do not rename it. Adding a second, more specific
 * reason would undo the guarantee above.
 */
export enum PersonalMemoryDatasetResolutionDenialReasons
{
	/**
	 * The identity was incomplete, the user has no Active dataset, or the row that came back had
	 * a blank id.
	 *
	 * A caller can only fail closed: there is no detail here to branch on, by design.
	 */
	MemoryScopeUnavailable = "memory_scope_unavailable",
}

/**
 * The result of a personal dataset lookup: either the dataset, or the single denial reason.
 *
 * @see {@link __ResolvePersonalMemoryDataset} which returns it, and
 * {@link PersonalMemoryDatasetResolutionDenialReasons} for why there is only one reason.
 */
export type ResolvePersonalMemoryDatasetResult = { readonly outcome: PersonalMemoryDatasetResolutionOutcomes.Resolved; readonly dataset: PersonalMemoryDataset } | { readonly outcome: PersonalMemoryDatasetResolutionOutcomes.Denied; readonly reason: PersonalMemoryDatasetResolutionDenialReasons.MemoryScopeUnavailable };
