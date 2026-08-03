/** Stable input and outcome codes for a proposal owner's explicit decision. */
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
	/** No still-decidable proposal belongs to the supplied user and silo. */
	NotFoundOrNotOwner = "not_found_or_not_owner",
	/** A decision already made the proposal terminal. */
	AlreadyDecided = "already_decided",
	/** Persistence failed before an authoritative decision result was available. */
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

/** Stable outcome from attempting the owner decision. */
export type DecidePersonalConfigurationChangeResult = { readonly outcome: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly outcome: PersonalConfigurationDecisionCodes.Denied; readonly reason: PersonalConfigurationDecisionCodes.InvalidCommand | PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable };

/** Extension port for the explicit decision lifecycle. */
export interface PersonalConfigurationChangeDecisionRepository
{
	/** Atomically accepts or rejects one still-proposed change owned by this user. */
	decideAtomically(command: DecidePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable }>;
}
