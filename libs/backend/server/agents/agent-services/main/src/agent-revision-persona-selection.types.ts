/** Request to copy one personal agent revision with only its persona changed. */
export interface MaterializeAgentRevisionPersonaSelectionCommand
{
	/** Silo that owns the personal service and both persona revisions. */
	readonly siloId: string;
	/** Subject who owns the personal service through the source and target persona profile. */
	readonly subjectId: string;
	/** Stable personal service whose revision lineage is extended. */
	readonly agentServiceId: string;
	/** Published active revision that must still be the service's latest revision. */
	readonly expectedSourceRevisionId: string;
	/** Approved persona revision that the new agent revision must select. */
	readonly targetPersonaRevisionId: string;
	/** Trusted subject recorded as the author of the new revision. */
	readonly authoredBy: string;
	/** Trusted instant used for creation, publication, and pointer replacement. */
	readonly materializedAt: Date;
	/** Human-readable explanation recorded on the immutable revision. */
	readonly changeMessage: string;
}

/** Request to find an owner's personal service and apply a persona selection to it. */
export interface MaterializePersonalAgentPersonaSelectionCommand
{
	/** Silo that owns the persona profile and any matching personal service. */
	readonly siloId: string;
	/** Subject that owns the target persona and any matching personal service. */
	readonly subjectId: string;
	/** Approved persona revision selected by the completed approval flow. */
	readonly targetPersonaRevisionId: string;
	/** Trusted subject recorded as the author of the new revision. */
	readonly authoredBy: string;
	/** Trusted instant used for creation, publication, and pointer replacement. */
	readonly materializedAt: Date;
	/** Human-readable explanation recorded on the immutable revision. */
	readonly changeMessage: string;
}

/**
 * Outcomes of selecting a persona on one stable personal agent.
 *
 * The agent-service package returns these values to onboarding repair and persona approval. They
 * are not persisted. `StaleSource` asks the caller to retry the whole transaction after re-reading;
 * `Unavailable` means authority evidence is missing or ambiguous and must fail closed.
 */
export enum AgentRevisionPersonaSelectionMaterializationCodes
{
	/** A new published revision was appended and made active. */
	Materialized = "materialized",
	/** The active published revision already selects the target persona, so no write was needed. */
	AlreadyCurrent = "already_current",
	/** The service moved away from the expected source or has a newer lineage entry. */
	StaleSource = "stale_source",
	/** Service, persona, ownership, or publication evidence was missing or ambiguous. */
	Unavailable = "unavailable",
	/** The owner has no personal service yet, so persona approval has nothing to update. */
	NotApplicable = "not_applicable",
}

/** Result when the caller already knows the stable service and source revision. */
export type MaterializeAgentRevisionPersonaSelectionResult =
	| { readonly status: AgentRevisionPersonaSelectionMaterializationCodes.Materialized; readonly agentRevisionId: string; readonly sourceRevisionId: string }
	| { readonly status: AgentRevisionPersonaSelectionMaterializationCodes.AlreadyCurrent; readonly agentRevisionId: string; readonly sourceRevisionId: string }
	| { readonly status: AgentRevisionPersonaSelectionMaterializationCodes.StaleSource; readonly sourceRevisionId: string }
	| { readonly status: AgentRevisionPersonaSelectionMaterializationCodes.Unavailable; readonly sourceRevisionId: string };

/** Result when the strategy first has to discover the owner's personal service. */
export type MaterializePersonalAgentPersonaSelectionResult = MaterializeAgentRevisionPersonaSelectionResult
	| { readonly status: AgentRevisionPersonaSelectionMaterializationCodes.NotApplicable; readonly sourceRevisionId: null };

/**
 * Changes the persona selected by a stable personal AgentService inside a caller-owned transaction.
 *
 * The implementation never creates a service. It appends a published immutable AgentRevision that
 * copies every source field except `personaRevisionId`, then replaces the active pointer. The caller
 * owns the commit so its persona or onboarding writes roll back with these writes.
 *
 * Implemented by: `PrismaAgentRevisionPersonaSelectionRepository`.
 * Called by: persona approval composition in `apps/opencrane` and completed-onboarding repair.
 */
export interface AgentRevisionPersonaSelectionRepository
{
	/** Applies the target persona to one known service and source revision. */
	materialize(command: MaterializeAgentRevisionPersonaSelectionCommand): Promise<MaterializeAgentRevisionPersonaSelectionResult>;
	/** Finds the owner's personal service, or returns `NotApplicable` when none exists. */
	materializeForOwner(command: MaterializePersonalAgentPersonaSelectionCommand): Promise<MaterializePersonalAgentPersonaSelectionResult>;
}
