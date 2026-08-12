/** Identifies one accepted persona-refresh proposal; only this package may check or apply it. */
export interface AcceptedPersonaRefreshCommand
{
	/** The accepted proposal the persona interview is attached to. */
	readonly configurationChangeId: string;
	/** Silo that owns every coordinate in the change. */
	readonly siloId: string;
	/** User who owns the proposal and persona profile. */
	readonly userId: string;
	/** Persona profile the proposal was recorded against. */
	readonly personaProfileId: string;
}

/**
 * Whether an accepted persona-refresh proposal may back a persona interview.
 *
 * `Accepted` is permission to go on and record the proposal's id against the interview.
 * `Unavailable` covers every reason it may not — wrong owner, wrong profile, not accepted, or
 * a different patch kind — so a caller cannot learn which. It must refuse the interview rather
 * than retry.
 *
 * Called by: `PrismaPersonaInterviewRepository` in
 * libs/backend/agents/personal/personas/main/src/interview/prisma-persona-interview-repository.ts,
 * which maps `Unavailable` to its own `RefreshChangeUnavailable` denial.
 */
export enum PersonalConfigurationPersonaRefreshClaimCodes
{
	/** The proposal is accepted, belongs to this user, and this interview may use it. */
	Accepted = "accepted",
	/** No accepted persona-refresh proposal matches every supplied coordinate. */
	Unavailable = "unavailable",
}

/**
 * The proposal checks and writes a persona refresh may make, inside the caller's transaction.
 *
 * Exists so the personas package never touches PersonalConfigurationChange rows directly: it
 * claims a proposal before starting an interview, and marks it applied once the interview's
 * persona revision is approved. Both calls share the personas package's own transaction, so a
 * persona revision and its proposal cannot commit apart.
 *
 * Called by: `PrismaPersonaInterviewRepository` and `PrismaPersonaAuthorityRepository` in
 * libs/backend/agents/personal/personas/main/src.
 *
 * @see {@link PrismaPersonalConfigurationPersonaRefreshRepository} for the only implementation.
 */
export interface PersonalConfigurationPersonaRefreshRepository
{
	/** Locks and verifies one accepted persona-refresh proposal before an interview records its identifier. */
	claimAcceptedPersonaRefresh(command: AcceptedPersonaRefreshCommand): Promise<PersonalConfigurationPersonaRefreshClaimCodes>;
	/**
	 * @param command - The proposal coordinates plus the approved persona revision id.
	 * @returns True when the proposal was still Accepted and is now Applied; false when it was
	 * not, in which case the caller must abandon the approval rather than proceed — the database
	 * trigger will otherwise reject the persona revision anyway.
	 */
	applyApprovedPersonaRefresh(command: AcceptedPersonaRefreshCommand & { readonly personaRevisionId: string }): Promise<boolean>;
}
