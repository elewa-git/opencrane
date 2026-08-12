/**
 * The decision a proposal owner can make, and what recording it came back with.
 *
 * Deciding records consent only. It changes no persona, no agent service, and no run — a later
 * materialisation step is what actually applies an accepted change. A caller must not tell the
 * user their agent has changed on the strength of `Accepted`.
 *
 * `Accepted` and `Rejected` are used both as the requested decision and as the recorded
 * outcome. Of the refusals, only `PersistenceUnavailable` is retryable; `NotFoundOrNotOwner`
 * and `AlreadyDecided` both mean the request will never succeed, and both are deliberately
 * mapped to the same 404 so a caller cannot discover another owner's proposal.
 */
export enum PersonalConfigurationDecisionCodes
{
	/** The owner consented to a later immutable configuration revision. */
	Accepted = "accepted",
	/** The owner declined the proposal with a reason. */
	Rejected = "rejected",
	/** The decision authority refused the caller-controlled request. */
	Denied = "denied",
	/** The accepted/rejected decision payload was malformed. */
	InvalidCommand = "invalid_command",
	/** No proposal with this id belongs to the supplied user and silo. */
	NotFoundOrNotOwner = "not_found_or_not_owner",
	/** The proposal was already accepted or rejected. */
	AlreadyDecided = "already_decided",
	/** The only retryable code: the write failed, so whether the decision was recorded is
	 * unknown. Re-read the proposal rather than assuming it was or was not decided. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Explicit owner decision for one durable future-session proposal. */
export interface DecidePersonalConfigurationChangeCommand
{
	/** Silo that owns the proposal. */
	readonly siloId: string;
	/** Proposal owner who is allowed to decide it. */
	readonly userId: string;
	/** Immutable proposal identifier. */
	readonly changeId: string;
	/** Explicit state selected by the owner. */
	readonly decision: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected;
	/** Required explanation only for rejection. */
	readonly rejectionReason: string | null;
	/** Trusted decision instant. */
	readonly decidedAt: string;
}

/**
 * What {@link __DecidePersonalConfigurationChange} returns: the recorded decision, or a denial
 * whose reason is only worth retrying when it is `PersistenceUnavailable`.
 */
export type DecidePersonalConfigurationChangeResult = { readonly outcome: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly outcome: PersonalConfigurationDecisionCodes.Denied; readonly reason: PersonalConfigurationDecisionCodes.InvalidCommand | PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable };

/**
 * Records the owner's accept-or-reject decision in the database.
 *
 * Called by: {@link __DecidePersonalConfigurationChange}; supplied to the router as
 * `dependencies.decisions`.
 *
 * @see {@link PrismaPersonalConfigurationDecisionRepository} for the only implementation.
 */
export interface PersonalConfigurationChangeDecisionRepository
{
	/**
	 * Moves the proposal to Accepted or Rejected only while it is still Proposed.
	 *
	 * @param command - Server-derived owner, proposal id, decision and time.
	 * @returns The recorded decision on success; `NotFoundOrNotOwner` when no such proposal
	 * belongs to this user; `AlreadyDecided` when it is no longer Proposed;
	 * `PersistenceUnavailable` when the write failed. Implementations must not throw for these.
	 */
	decideAtomically(command: DecidePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable }>;
}
