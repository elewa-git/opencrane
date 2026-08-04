/** Trusted request to apply one accepted personal model selection to a future run revision. */
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

/** Stable product outcome from applying an accepted personal model selection. */
export type MaterializePersonalConfigurationChangeResult =
	| { readonly outcome: PersonalConfigurationMaterializationCodes.Applied; readonly agentRevisionId: string }
	| { readonly outcome: PersonalConfigurationMaterializationCodes.NotApplicable }
	| { readonly outcome: PersonalConfigurationMaterializationCodes.Denied; readonly reason: PersonalConfigurationMaterializationCodes.InvalidCommand | PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner | PersonalConfigurationMaterializationCodes.NotAccepted | PersonalConfigurationMaterializationCodes.StaleProposal | PersonalConfigurationMaterializationCodes.ModelUnavailable | PersonalConfigurationMaterializationCodes.PersistenceUnavailable };

/** Atomic persistence outcome after evaluating and, when possible, applying one accepted proposal. */
export type PersonalConfigurationMaterializationPersistenceResult =
	| { readonly status: PersonalConfigurationMaterializationCodes.Applied; readonly agentRevisionId: string }
	| { readonly status: PersonalConfigurationMaterializationCodes.NotApplicable | PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner | PersonalConfigurationMaterializationCodes.NotAccepted | PersonalConfigurationMaterializationCodes.StaleProposal | PersonalConfigurationMaterializationCodes.ModelUnavailable | PersonalConfigurationMaterializationCodes.PersistenceUnavailable };

/** Persistence boundary that materialises a proposal without changing an in-flight run. */
export interface PersonalConfigurationChangeMaterializationRepository
{
	/** Applies the accepted model-alias proposal to a fresh immutable personal AgentRevision. */
	materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationPersistenceResult>;
}
/**
 * Stable outcomes from materializing an accepted personal model-alias proposal.
 *
 * These values cross the router, materialization authority, and Prisma adapter. The enum is the
 * only package-owned vocabulary for those boundaries; its strings remain existing API values.
 */
export enum PersonalConfigurationMaterializationCodes
{
	/** The proposal was applied to a new immutable agent revision. */
	Applied = "applied",
	/** The accepted proposal belongs to another configuration workflow. */
	NotApplicable = "not_applicable",
	/** The owner-bound command was malformed. */
	InvalidCommand = "invalid_command",
	/** No proposal belongs to the supplied user and silo. */
	NotFoundOrNotOwner = "not_found_or_not_owner",
	/** The proposal has not been accepted. */
	NotAccepted = "not_accepted",
	/** A later persona or service revision invalidated the proposal. */
	StaleProposal = "stale_proposal",
	/** The requested model alias is not available in the owner silo. */
	ModelUnavailable = "model_unavailable",
	/** Persistence failed before an authoritative materialization result was available. */
	PersistenceUnavailable = "persistence_unavailable",
	/** The authority refused the materialization request. */
	Denied = "denied",
}
