/**
 * Stable result codes for applying an accepted personal configuration proposal.
 *
 * The enum covers both authority outcomes and repository statuses because repository refusals are
 * deliberately preserved as caller-visible denial reasons. Each result type below selects only the
 * members that are meaningful in that position, while every branch uses one documented spelling.
 */
export enum PersonalConfigurationMaterializationCodes
{
	/** The model-alias proposal produced and activated a new immutable personal agent revision. */
	Applied = "applied",
	/** The accepted proposal belongs to another authority, currently the persona-refresh workflow. */
	NotApplicable = "not_applicable",
	/** The materialization authority refused the request without activating a revision. */
	Denied = "denied",
	/** The trusted materialization command was malformed before persistence was consulted. */
	InvalidCommand = "invalid_command",
	/** No proposal exists for the exact owner, silo, and change identifier. */
	NotFoundOrNotOwner = "not_found_or_not_owner",
	/** The proposal has not reached the accepted lifecycle state required for application. */
	NotAccepted = "not_accepted",
	/** The profile or agent revision changed after proposal, so the recorded snapshot is obsolete. */
	StaleProposal = "stale_proposal",
	/** The proposal's human-visible model alias does not resolve inside the owner's silo. */
	ModelUnavailable = "model_unavailable",
	/** The materialization transaction failed before an authoritative result was recorded. */
	PersistenceUnavailable = "persistence_unavailable",
}

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

/** Stable outcome from applying an accepted personal model selection. */
export type MaterializePersonalConfigurationChangeResult =
	| { readonly outcome: PersonalConfigurationMaterializationCodes.Applied; readonly agentRevisionId: string }
	| { readonly outcome: PersonalConfigurationMaterializationCodes.NotApplicable }
	| { readonly outcome: PersonalConfigurationMaterializationCodes.Denied; readonly reason: PersonalConfigurationMaterializationCodes.InvalidCommand | PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner | PersonalConfigurationMaterializationCodes.NotAccepted | PersonalConfigurationMaterializationCodes.StaleProposal | PersonalConfigurationMaterializationCodes.ModelUnavailable | PersonalConfigurationMaterializationCodes.PersistenceUnavailable };

/** Persistence boundary that materialises a proposal without changing an in-flight run. */
export interface PersonalConfigurationChangeMaterializationRepository
{
	/** Applies the accepted model-alias proposal to a fresh immutable personal AgentRevision. */
	materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationMaterializationCodes.Applied; readonly agentRevisionId: string } | { readonly status: PersonalConfigurationMaterializationCodes.NotApplicable | PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner | PersonalConfigurationMaterializationCodes.NotAccepted | PersonalConfigurationMaterializationCodes.StaleProposal | PersonalConfigurationMaterializationCodes.ModelUnavailable | PersonalConfigurationMaterializationCodes.PersistenceUnavailable }>;
}
