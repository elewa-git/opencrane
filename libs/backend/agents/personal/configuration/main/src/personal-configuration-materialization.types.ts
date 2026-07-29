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
	| { readonly outcome: "applied"; readonly agentRevisionId: string }
	| { readonly outcome: "not_applicable" }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found_or_not_owner" | "not_accepted" | "stale_proposal" | "model_unavailable" | "persistence_unavailable" };

/** Atomic persistence outcome after evaluating and, when possible, applying one accepted proposal. */
export type PersonalConfigurationMaterializationPersistenceResult =
	| { readonly status: "applied"; readonly agentRevisionId: string }
	| { readonly status: "not_applicable" | "not_found_or_not_owner" | "not_accepted" | "stale_proposal" | "model_unavailable" | "persistence_unavailable" };

/** Persistence boundary that materialises a proposal without changing an in-flight run. */
export interface PersonalConfigurationChangeMaterializationRepository
{
	/** Applies the accepted model-alias proposal to a fresh immutable personal AgentRevision. */
	materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationPersistenceResult>;
}
