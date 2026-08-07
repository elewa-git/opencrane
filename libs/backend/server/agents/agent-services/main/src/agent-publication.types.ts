import type { AgentRevision, AgentRevisionId, AgentService, AgentServiceId, AgentServiceState, SiloId } from "@opencrane/models/agents";

/** Command that publishes one immutable agent revision as the service's active revision. */
export interface PublishAgentRevisionCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Stable service whose active revision will change. */
	readonly agentServiceId: AgentServiceId;
	/** Draft immutable revision to publish. */
	readonly agentRevisionId: AgentRevisionId;
	/** Active revision observed by the caller, used for optimistic concurrency. */
	readonly expectedActiveRevisionId: AgentRevisionId | null;
	/** Trusted ISO-8601 publication instant. */
	readonly publishedAt: string;
}

/** Atomic publication request after the domain has validated service and revision ownership. */
export interface AtomicAgentRevisionPublication
{
	/** Stable service receiving the published revision. */
	readonly agentServiceId: AgentServiceId;
	/** Service lifecycle state observed before publication, required for the compare-and-swap. */
	readonly expectedServiceState: AgentServiceState;
	/** Draft revision being published. */
	readonly agentRevisionId: AgentRevisionId;
	/** Active revision required for the compare-and-swap. */
	readonly expectedActiveRevisionId: AgentRevisionId | null;
	/** Publication instant persisted on the immutable published projection. */
	readonly publishedAt: string;
}

/** Result returned by the repository's publication compare-and-swap. */
export type AtomicAgentRevisionPublicationResult =
	| { readonly status: "published"; readonly service: AgentService; readonly revision: AgentRevision }
	| { readonly status: "conflict"; readonly currentActiveRevisionId: AgentRevisionId | null };

/** Concurrency-capable persistence boundary for agent-service publication. */
export interface AgentServicePublicationRepository
{
	/** Loads one stable service identity scoped to the caller's silo, or null. */
	getService(agentServiceId: AgentServiceId, siloId: SiloId): Promise<AgentService | null>;
	/** Loads one immutable revision whose parent service is in the caller's silo, or null. */
	getRevision(agentRevisionId: AgentRevisionId, siloId: SiloId): Promise<AgentRevision | null>;
	/** Atomically publishes the draft and activates it only when the expected active revision still matches. */
	publishRevisionAtomically(publication: AtomicAgentRevisionPublication): Promise<AtomicAgentRevisionPublicationResult>;
}

/** Stable reason that publication did not change authority state. */
export type PublishAgentRevisionFailureReason =
	| "invalid_command"
	| "service_not_found"
	| "service_retired"
	| "revision_not_found"
	| "revision_service_mismatch"
	| "revision_not_draft"
	| "invalid_revision"
	| "publication_conflict";

/** Result of publishing one immutable agent revision. */
export type PublishAgentRevisionResult =
	| { readonly outcome: "published"; readonly service: AgentService; readonly revision: AgentRevision }
	| { readonly outcome: "denied"; readonly reason: PublishAgentRevisionFailureReason; readonly currentActiveRevisionId?: AgentRevisionId | null };
