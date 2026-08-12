/**
 * A request to apply one accepted proposal, producing a revision that only later runs use.
 *
 * Every field is supplied by the server, not the browser: the caller of the HTTP route provides
 * only the proposal id in the path. `userId` is both the owner check and the author recorded on
 * the new revision, so a proposal can only ever be applied by the user who owns it.
 *
 * @see {@link MaterializePersonalConfigurationChangeResult} for what comes back.
 */
export interface MaterializePersonalConfigurationChangeCommand
{
	/** Silo that owns the proposal, personal service, and selected model. */
	readonly siloId: string;
	/** Proposal owner who alone may request application. */
	readonly userId: string;
	/** Accepted proposal that may be materialised exactly once. */
	readonly changeId: string;
	/** Trusted instant recorded on the new immutable revision. */
	readonly materializedAt: string;
}

/**
 * What {@link __MaterializePersonalConfigurationChange} returns.
 *
 * `Applied` carries the new `agentRevisionId`; `NotApplicable` means a persona refresh applies
 * elsewhere and nothing is owed; `Denied` carries a reason of which only
 * `PersistenceUnavailable` is worth retrying. See {@link PersonalConfigurationMaterializationCodes}.
 */
export type MaterializePersonalConfigurationChangeResult =
	| { readonly outcome: PersonalConfigurationMaterializationCodes.Applied; readonly agentRevisionId: string }
	| { readonly outcome: PersonalConfigurationMaterializationCodes.NotApplicable }
	| { readonly outcome: PersonalConfigurationMaterializationCodes.Denied; readonly reason: PersonalConfigurationMaterializationCodes.InvalidCommand | PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner | PersonalConfigurationMaterializationCodes.NotAccepted | PersonalConfigurationMaterializationCodes.StaleProposal | PersonalConfigurationMaterializationCodes.ModelUnavailable | PersonalConfigurationMaterializationCodes.PersistenceUnavailable };

/**
 * What the materialisation transaction returned, before the outer function narrows it.
 *
 * Differs from {@link MaterializePersonalConfigurationChangeResult} only in shape — `status`
 * rather than `outcome`/`reason`. Every value describes a committed state, because the
 * transaction either completed or rolled back entirely.
 */
export type PersonalConfigurationMaterializationPersistenceResult =
	| { readonly status: PersonalConfigurationMaterializationCodes.Applied; readonly agentRevisionId: string }
	| { readonly status: PersonalConfigurationMaterializationCodes.NotApplicable | PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner | PersonalConfigurationMaterializationCodes.NotAccepted | PersonalConfigurationMaterializationCodes.StaleProposal | PersonalConfigurationMaterializationCodes.ModelUnavailable | PersonalConfigurationMaterializationCodes.PersistenceUnavailable };

/**
 * Applies one accepted proposal, creating a new immutable AgentRevision.
 *
 * A run already in flight is never touched: it keeps the input snapshot it was admitted with,
 * so a configuration change can never alter a conversation that is already executing.
 *
 * Called by: {@link __MaterializePersonalConfigurationChange}; supplied to the router as
 * `dependencies.materializer`.
 *
 * @see {@link _PersonalConfigurationMaterializer} for the implementation that drives the
 * cross-domain transaction.
 */
export interface PersonalConfigurationChangeMaterializationRepository
{
	/**
	 * @param command - Server-derived owner, proposal id and time.
	 * @returns `Applied` with the new revision id; `NotApplicable` when a persona refresh owns
	 * this patch kind; or a refusal status. Implementations must not throw for an expected
	 * refusal — they return `PersistenceUnavailable` instead, so the caller has one failure path.
	 */
	materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationPersistenceResult>;
}
/**
 * What an attempt to apply an accepted personal configuration proposal came back with.
 *
 * Applying a proposal means creating a new immutable AgentRevision carrying the chosen model,
 * then marking the proposal Applied. Both happen in one transaction, so every code below
 * describes a state the database is actually in — never a half-done application.
 *
 * The codes split three ways, and a caller must treat each differently:
 * - `Applied` is success and carries the new `agentRevisionId`. Runs started from now on use
 *   it; runs already in flight are untouched.
 * - `NotApplicable` is not a failure. The proposal was accepted, but it is a persona refresh,
 *   which the persona approval flow applies instead. Reporting it as an error would tell the
 *   user their accepted change failed when it is simply applied elsewhere.
 * - `PersistenceUnavailable` is the only retryable code. It means the write failed after the
 *   unit of work used up its retries, and the caller cannot tell whether anything committed, so
 *   it must re-read state rather than assume either outcome.
 * - `InvalidCommand`, `NotFoundOrNotOwner`, `NotAccepted`, `StaleProposal` and `ModelUnavailable`
 *   are refusals. Retrying the same request cannot change any of them.
 *
 * Conflating `PersistenceUnavailable` with a refusal is the damaging mistake: a refusal tells
 * the user to stop, while an unavailable write may have to be retried before the proposal is
 * actually applied.
 *
 * These strings are part of the HTTP API — the materialize route returns them as its error
 * body — so do not rename them.
 *
 * @see {@link MaterializePersonalConfigurationChangeResult} for the caller-facing shape.
 */
export enum PersonalConfigurationMaterializationCodes
{
	/** Success: a new immutable AgentRevision was created and the proposal is now Applied. */
	Applied = "applied",
	/**
	 * Not a failure: the proposal is a persona refresh, which the persona approval flow applies.
	 * Nothing was written here and nothing is owed. Do not surface this as an error.
	 */
	NotApplicable = "not_applicable",
	/** The owner-bound command was malformed. */
	InvalidCommand = "invalid_command",
	/** Refusal: no proposal with this id belongs to this user and silo. Returned for another
	 * owner's proposal too, so a caller cannot use it to discover that one exists. */
	NotFoundOrNotOwner = "not_found_or_not_owner",
	/** Refusal: the proposal is still Proposed, or was Rejected or Superseded. The owner must
	 * decide it first; retrying without a decision cannot succeed. */
	NotAccepted = "not_accepted",
	/** Refusal: the persona or agent revision moved on after the owner accepted, so the accepted
	 * choice no longer describes the agent. The user must propose the change again. */
	StaleProposal = "stale_proposal",
	/** The requested model alias is not available in the owner silo. */
	ModelUnavailable = "model_unavailable",
	/**
	 * The only retryable code. The write failed after the unit of work used up its retries, so
	 * whether anything committed is unknown. Re-read the proposal's state before retrying, and
	 * never report the change as applied or as refused on the strength of this code alone.
	 */
	PersistenceUnavailable = "persistence_unavailable",
	/** The authority refused the materialization request. */
	Denied = "denied",
}
