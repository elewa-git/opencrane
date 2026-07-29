import type { AgentRevisionContent } from "@opencrane/models/agents";

/** Complete immutable evidence required to append one agent revision within an existing transaction. */
export interface CreateAgentRevisionWithinTransactionCommand
{
	/** Silo copied onto nested integration assignments for the owning service. */
	readonly siloId: string;
	/** Stable service that owns the revision lineage. */
	readonly agentServiceId: string;
	/** Monotonic revision number within the service. */
	readonly revision: number;
	/** Current lineage head from which the new revision derives. */
	readonly parentRevisionId: string | null;
	/** Historical revision cloned by a restore, otherwise null. */
	readonly sourceRevisionId: string | null;
	/** Complete executable content used for both persistence and digest calculation. */
	readonly content: AgentRevisionContent;
	/** Human-readable explanation of why the revision was created. */
	readonly changeMessage: string;
	/** Trusted subject that authored the revision. */
	readonly authoredBy: string;
	/** Trusted creation instant. */
	readonly createdAt: Date;
}

/** Intent to clone one active personal revision with a newly selected model definition. */
export interface MaterializeAgentRevisionModelSelectionWithinTransactionCommand
{
	/** Silo that owns both the personal service and selected model definition. */
	readonly siloId: string;
	/** Personal service whose locked active revision is being replaced. */
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

/** Result of the agent-service-owned model-selection materialization. */
export type MaterializeAgentRevisionModelSelectionWithinTransactionResult =
	| { readonly status: "materialized"; readonly agentRevisionId: string }
	| { readonly status: "model_unavailable" }
	| { readonly status: "stale_source" };
