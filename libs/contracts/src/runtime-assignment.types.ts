import type { AgentRevisionId, AgentRunId, AgentServiceId, PersonaRevisionId, SiloId } from "@opencrane/models/agents";

/** Immutable user identity projected into a runtime assignment frame. */
export interface UserRuntimeAssignmentIdentity
{
	/** Discriminant that keeps a human membership revision distinct from service authority. */
	kind: "user";
	/** Human subject whose membership authorized this run. */
	executionSubjectId: string;
	/** Highest verified fleet-membership revision used for authorization. */
	fleetMembershipRevision: number;
}

/** Immutable managed-service identity projected into a runtime assignment frame. */
export interface ServiceRuntimeAssignmentIdentity
{
	/** Discriminant that keeps a service principal distinct from a human member. */
	kind: "service";
	/** Canonical `agent-service:<AgentServiceId>` principal authorized for this run. */
	executionSubjectId: string;
	/** Active managed service whose immutable revision owns the execution authority. */
	agentServiceId: AgentServiceId;
	/** Highest verified fleet-membership revision used for this service principal. */
	fleetMembershipRevision: number;
	/** Digest binding the exact effective scope-attachment set into the service authority. */
	effectiveScopeAttachmentDigest: string;
}

/** Tagged immutable identity carried by every runtime assignment. */
export type RuntimeAssignmentIdentity = UserRuntimeAssignmentIdentity | ServiceRuntimeAssignmentIdentity;

/** Immutable proof-bound assignment consumed by an agent runtime Pod. */
export interface RuntimeAssignment
{
	/** Run authorized for this assignment. */
	readonly runId: AgentRunId;
	/** Positive run attempt authorized for this exact workload assignment. */
	readonly attempt: number;
	/** AgentService authorized for this assignment. */
	readonly agentServiceId: AgentServiceId;
	/** Immutable AgentRevision authorized for this assignment. */
	readonly agentRevisionId: AgentRevisionId;
	/** Approved persona revision compiled for the run, when personal. */
	readonly personaRevisionId?: PersonaRevisionId;
	/** Silo in which the assignment is valid. */
	readonly siloId: SiloId;
	/** Tagged user or service identity whose signed membership evidence authorized the run. */
	readonly identity: RuntimeAssignmentIdentity;
	/** Digest of the effective proof-bound capability set. */
	readonly capabilitySetDigest: string;
	/** Expected Kubernetes service account name. */
	readonly serviceAccountName: string;
	/** Expected runtime Pod UID. */
	readonly podUid: string;
	/** Digest of canonical assignment claims. */
	readonly assignmentDigest: string;
	/** ISO-8601 issuance time. */
	readonly issuedAt: string;
	/** ISO-8601 hard expiry time. */
	readonly expiresAt: string;
}
