import type { AgentRevision, AgentRevisionDiff, AgentRevisionId, AgentRun, AgentService, AgentServiceId, AgentServiceState, RevisionScopeAttachment, SiloId } from "@opencrane/models/agents";

/** Immutable executable content authored for one managed-agent revision. */
export interface AgentRevisionContent
{
	/** Versioned platform prompt-policy reference, diffed line by line. */
	readonly promptPolicyVersion: string;
	/** Approved persona revision, or null for a managed agent. */
	readonly personaRevisionId: string | null;
	/** Registered model-definition reference; carries no provider secret. */
	readonly modelDefinitionId: string;
	/** Immutable resource ceilings applied to each run. */
	readonly budget: { readonly maxTurns: number; readonly maxTokens: number; readonly maxDurationMs: number };
	/** Immutable skill revisions exposed to the runtime. */
	readonly skills: readonly { readonly skillId: string; readonly revisionId: string }[];
	/** Immutable integration and tool assignments exposed to the runtime. */
	readonly integrationAssignments: readonly { readonly integrationId: string; readonly custodyReferenceId: string; readonly allowedTools: readonly string[] }[];
	/** Revision-scoped knowledge scope attachments authorised for the runtime. */
	readonly scopeAttachments: readonly RevisionScopeAttachment[];
}

/** Command that creates one managed AgentService with its first draft revision. */
export interface CreateManagedAgentServiceCommand
{
	/** Silo that will own the service. */
	readonly siloId: SiloId;
	/** Human-readable service name. */
	readonly name: string;
	/** Named workload profile projecting runtime policy. */
	readonly workloadProfile: string;
	/** Author of the first revision. */
	readonly authoredBy: string;
	/** Human-authored explanation of the initial revision. */
	readonly changeMessage: string;
	/** Executable content of the first draft revision. */
	readonly content: AgentRevisionContent;
}

/** Command that appends one new draft revision editing the expected head. */
export interface ReviseAgentRevisionCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Service being revised. */
	readonly agentServiceId: AgentServiceId;
	/** Revision the author based the edit on, for optimistic concurrency. */
	readonly expectedParentRevisionId: AgentRevisionId | null;
	/** Author of the new revision. */
	readonly authoredBy: string;
	/** Human-authored explanation of the change. */
	readonly changeMessage: string;
	/** Executable content of the new draft revision. */
	readonly content: AgentRevisionContent;
}

/** Command that restores an older revision by cloning it into a new draft revision. */
export interface RestoreAgentRevisionCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Service being restored. */
	readonly agentServiceId: AgentServiceId;
	/** Older revision whose content is cloned; recorded as the source revision. */
	readonly sourceRevisionId: AgentRevisionId;
	/** Revision the author based the restore on, for optimistic concurrency. */
	readonly expectedParentRevisionId: AgentRevisionId | null;
	/** Author of the restore revision. */
	readonly authoredBy: string;
	/** Human-authored explanation of the restore. */
	readonly changeMessage: string;
}

/** Lifecycle action changing a stable AgentService state. */
export type AgentServiceLifecycleAction = "enable" | "pause" | "retire";

/** Command that changes a stable AgentService state with optimistic concurrency. */
export interface ChangeAgentServiceStateCommand
{
	/** Silo the caller is operating within; a service in another silo must not resolve. */
	readonly siloId: SiloId;
	/** Service whose state is changing. */
	readonly agentServiceId: AgentServiceId;
	/** State the caller observed, for optimistic concurrency. */
	readonly expectedState: AgentServiceState;
	/** Lifecycle action requested. */
	readonly action: AgentServiceLifecycleAction;
}

/** Why a managed run was admitted: an explicit run-now, or a due schedule slot. */
export type ManagedRunTrigger = "managed_invocation" | "schedule";

/** Command that records one managed run admission request. */
export interface ManagedRunNowCommand
{
	/** Service to run. */
	readonly agentServiceId: AgentServiceId;
	/** Silo containing the service and durable run. */
	readonly siloId: SiloId;
	/** Subject requesting the run (a human for run-now, the scheduler identity for a schedule). */
	readonly requestedBy: string;
	/** User-visible key making duplicate delivery return the first admission. */
	readonly requestIdempotencyKey: string;
	/**
	 * Trigger recorded on the admitted run. `managed_invocation` for an explicit run-now;
	 * `schedule` for a due schedule slot. The admission adapter maps this to the durable
	 * `AgentRunTrigger`; it never opens a second run-creation path.
	 */
	readonly trigger: ManagedRunTrigger;
	/**
	 * Exact ISO-8601 scheduled-slot instant for a `schedule` trigger, or null for run-now. Carried
	 * so the admission audit can attribute a run to its cron slot; the idempotency key already
	 * encodes it, so it is descriptive rather than an independent dedup key.
	 */
	readonly scheduledSlot: string | null;
}

/** Stable reason a lifecycle command was refused before touching authority state. */
export type AgentRevisionLifecycleDenial =
	| "invalid_command"
	| "service_not_found"
	| "service_retired"
	| "revision_not_found"
	| "revision_service_mismatch"
	| "model_definition_unavailable"
	| "transition_not_allowed"
	| "service_not_runnable"
	| "run_admission_unavailable"
	| "persistence_unavailable"
	| "authority_conflict"
	| "admission_concurrency_limited";

/** Result of creating a managed service. */
export type CreateManagedAgentServiceResult =
	| { readonly outcome: "created"; readonly service: AgentService; readonly revision: AgentRevision }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/** Result of appending a revision through revise or restore. */
export type AppendAgentRevisionResult =
	| { readonly outcome: "revised"; readonly revision: AgentRevision }
	| { readonly outcome: "conflict"; readonly currentHeadRevisionId: AgentRevisionId | null }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/** Result of a stable-service state change. */
export type ChangeAgentServiceStateResult =
	| { readonly outcome: "changed"; readonly service: AgentService }
	| { readonly outcome: "conflict"; readonly currentState: AgentServiceState }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/** Result of comparing two revisions of the same service. */
export type CompareAgentRevisionsResult =
	| { readonly outcome: "compared"; readonly base: AgentRevision; readonly target: AgentRevision; readonly diff: AgentRevisionDiff }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/** Read-only run history for one service. */
export interface AgentServiceHistory
{
	/** Immutable revision lineage, newest first. */
	readonly revisions: readonly AgentRevision[];
	/** Durable run-history records, newest first. */
	readonly runs: readonly AgentRun[];
}

/** Concurrency-capable persistence boundary for the managed-agent definition plane. */
export interface AgentRevisionLifecycleRepository
{
	/** Loads one stable service identity scoped to the caller's silo, or null when absent. */
	getService(agentServiceId: AgentServiceId, siloId: SiloId): Promise<AgentService | null>;
	/** Loads one immutable revision whose parent service is in the caller's silo, or null. */
	getRevision(agentRevisionId: AgentRevisionId, siloId: SiloId): Promise<AgentRevision | null>;
	/** Creates a managed service and its first draft revision atomically. */
	createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>;
	/** Appends a new draft revision editing the expected head atomically, silo-scoped. */
	reviseRevision(command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>;
	/** Clones an older revision into a new draft revision atomically, silo-scoped. */
	restoreRevision(command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>;
	/** Changes a stable service state under optimistic concurrency atomically, silo-scoped. */
	changeServiceState(command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>;
	/** Reads the silo-scoped revision lineage and durable run history for one service. */
	readHistory(agentServiceId: AgentServiceId, siloId: SiloId, runLimit: number): Promise<AgentServiceHistory>;
}

/** Result of admitting one managed run-now request. */
export type ManagedRunAdmissionResult =
	| { readonly outcome: "accepted"; readonly runId: string }
	| { readonly outcome: "idempotent"; readonly runId: string }
	| { readonly outcome: "denied"; readonly reason: AgentRevisionLifecycleDenial };

/** App-owned boundary that records a managed run admission on the shared run substrate. */
export interface ManagedRunAdmissionPort
{
	/**
	 * Records one managed run admission for the service's active revision.
	 * The implementation admits the run through the existing run-admission path with
	 * `trigger: managed_invocation`; it must not dispatch a Job, schedule, or execute anything.
	 */
	admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>;
}
