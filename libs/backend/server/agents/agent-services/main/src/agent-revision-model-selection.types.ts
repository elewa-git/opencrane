/** Intent to clone one active personal revision with a newly selected model definition. */
export interface MaterializeAgentRevisionModelSelectionCommand
{
	/** Silo that owns both the personal service and selected model definition. */
	readonly siloId: string;
	/** Personal service whose active revision is being replaced in the serializable transaction. */
	readonly agentServiceId: string;
	/** Active revision accepted when the owner reviewed the model proposal. */
	readonly expectedSourceRevisionId: string;
	/** Persona revision accepted with the proposal and preserved in the clone. */
	readonly expectedPersonaRevisionId: string | null;
	/** Normalized owner-visible alias resolved without accepting a provider identifier. */
	readonly modelAlias: string;
	/** Human-readable explanation recorded on the immutable revision. */
	readonly changeMessage: string;
	/** Trusted owner subject recorded as the author. */
	readonly authoredBy: string;
	/** Trusted instant used for creation, publication, and service activation. */
	readonly materializedAt: Date;
}

/**
 * Stable results from agent-services' model-selection strategy.
 *
 * Personal configuration consumes these values across a package boundary, so agent-services owns
 * the vocabulary and preserves the strings while callers compile against one shared contract.
 */
export enum AgentRevisionModelSelectionMaterializationCodes
{
	/** A new immutable revision was appended and activated. */
	Materialized = "materialized",
	/** No registered model definition matches the owner-visible alias in the silo. */
	ModelUnavailable = "model_unavailable",
	/** The service or source revision changed after the proposal was accepted. */
	StaleSource = "stale_source",
}

/** Result of the agent-service-owned model-selection strategy. */
export type MaterializeAgentRevisionModelSelectionResult =
	| { readonly status: AgentRevisionModelSelectionMaterializationCodes.Materialized; readonly agentRevisionId: string }
	| { readonly status: AgentRevisionModelSelectionMaterializationCodes.ModelUnavailable }
	| { readonly status: AgentRevisionModelSelectionMaterializationCodes.StaleSource };

/** Agent-service strategy port used inside an owning unit-of-work transaction. */
export interface AgentRevisionModelSelectionRepository
{
	/** Revalidates the accepted source and atomically prepares the selected-model revision. */
	materialize(command: MaterializeAgentRevisionModelSelectionCommand): Promise<MaterializeAgentRevisionModelSelectionResult>;
}
