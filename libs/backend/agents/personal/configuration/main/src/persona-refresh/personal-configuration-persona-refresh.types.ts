/** Accepted persona-refresh coordinates that configuration alone may verify or apply. */
export interface AcceptedPersonaRefreshCommand
{
	/** Accepted configuration proposal bound to the persona interview. */
	readonly configurationChangeId: string;
	/** Silo that owns every coordinate in the change. */
	readonly siloId: string;
	/** User who owns the proposal and persona profile. */
	readonly userId: string;
	/** Persona profile that must match the proposal evidence. */
	readonly personaProfileId: string;
}

/** Result of claiming an accepted persona-refresh proposal for an interview. */
export enum PersonalConfigurationPersonaRefreshClaimCodes
{
	/** The proposal is accepted, owner-bound, and may support this interview. */
	Accepted = "accepted",
	/** No accepted persona-refresh proposal matches every supplied coordinate. */
	Unavailable = "unavailable",
}

/** Configuration-owned operations available inside one persona-refresh transaction. */
export interface PersonalConfigurationPersonaRefreshRepository
{
	/** Locks and verifies one accepted persona-refresh proposal before an interview records its identifier. */
	claimAcceptedPersonaRefresh(command: AcceptedPersonaRefreshCommand): Promise<PersonalConfigurationPersonaRefreshClaimCodes>;
	/** Marks the exact accepted proposal applied after its interview-derived persona revision is approved. */
	applyApprovedPersonaRefresh(command: AcceptedPersonaRefreshCommand & { readonly personaRevisionId: string }): Promise<boolean>;
}

/** Atomic configuration-owned transaction seam used by the persona authority. */
export interface PersonalConfigurationPersonaRefreshUnitOfWork
{
	/** Runs persona persistence and configuration state changes in the same serializable transaction. */
	runPersonaRefresh<Result>(work: (transaction: unknown, refreshes: PersonalConfigurationPersonaRefreshRepository) => Promise<Result>): Promise<Result>;
}
