import type { ConversationId } from "@opencrane/models/conversations";
import type { AgentRevisionId, AgentRunId, AgentServiceId, SiloId } from "./identifiers.types";

/** Records the exact current AgentIdentity head that admission verified for an execution subject. */
export interface ExecutionSubjectIdentityEvidence
{
	/** Identifies the identity whose head was verified. */
	readonly agentIdentityId: string;
	/** Identifies the principal that the verified identity currently realizes. */
	readonly principalId: string;
	/** Identifies the silo that owns the verified identity. */
	readonly siloId: SiloId;
	/** Stores the exact zero-based Kurrent identity-head revision accepted at admission in canonical decimal. */
	readonly headRevision: string;
	/** Stores the SHA-256 digest of the exact current identity head. */
	readonly headDigest: string;
	/** Identifies the authority evidence that verified this identity head. */
	readonly decisionEvidenceId: string;
	/** Records when the authority verified this identity head. */
	readonly verifiedAt: string;
}

/** Records current fleet-membership evidence for the principal that executes one run. */
export interface ExecutionSubjectMembershipEvidence
{
	/** Identifies the principal whose current membership was verified. */
	readonly principalId: string;
	/** Identifies the silo in which the membership is valid. */
	readonly siloId: SiloId;
	/** Stores the monotonic signed membership revision accepted at admission. */
	readonly revision: number;
	/** Identifies the signed membership assertion accepted at admission. */
	readonly assertionId: string;
	/** Stores the SHA-256 digest of the signed membership payload. */
	readonly payloadDigest: string;
	/** Identifies the authority evidence that verified the membership assertion. */
	readonly decisionEvidenceId: string;
	/** Records when the signed membership assertion expires. */
	readonly trustedUntil: string;
}

/** Records the exact current capability decision that constrains one execution subject. */
export interface ExecutionSubjectCapabilityEvidence
{
	/** Identifies the agent identity whose capability set was evaluated. */
	readonly agentIdentityId: string;
	/** Identifies the conversation computer that received the capability set. */
	readonly computerId: string;
	/** Stores the SHA-256 digest of the admitted capability set. */
	readonly capabilitySetDigest: string;
	/** Stores the SHA-256 digest of the effective authorization contract. */
	readonly effectiveContractDigest: string;
	/** Identifies the authority decision that admitted this capability set. */
	readonly decisionEvidenceId: string;
	/** Records when the authority evaluated this capability set. */
	readonly decidedAt: string;
}

/** Names the fenced run that one execution subject may exercise. */
export interface ExecutionSubjectRunScope
{
	/** Identifies the silo in which this execution scope is valid. */
	readonly siloId: SiloId;
	/** Identifies the one admitted run. */
	readonly runId: AgentRunId;
	/** Identifies the active positive run attempt. */
	readonly attempt: number;
	/** Identifies the agent service that owns the run. */
	readonly agentServiceId: AgentServiceId;
	/** Identifies the immutable agent revision accepted for the run. */
	readonly agentRevisionId: AgentRevisionId;
}

/** Names the fenced conversation-computer realization that may exercise an execution subject. */
export interface ExecutionSubjectComputerScope
{
	/** Identifies the silo in which this computer scope is valid. */
	readonly siloId: SiloId;
	/** Identifies the logical conversation computer that owns this realization. */
	readonly computerId: string;
	/** Identifies the current computer lease. */
	readonly leaseId: string;
	/** Stores the positive lease generation that fences replaced sandboxes. */
	readonly leaseGeneration: number;
}

/** Records who requested execution without treating the requester as its authorizing principal. */
export interface ExecutionSubjectRequesterProvenance
{
	/** Identifies the silo in which the request was authenticated. */
	readonly siloId: SiloId;
	/** Identifies the authenticated principal that requested this run. */
	readonly requesterPrincipalId: string;
	/** Identifies the idempotency key supplied with the originating request. */
	readonly requestIdempotencyKey: string;
	/** Records when the server authenticated the requester. */
	readonly authenticatedAt: string;
}

/** Records the separate authority decision that admitted one requested execution. */
export interface ExecutionSubjectAdmissionEvidence
{
	/** Identifies the principal whose current authority admitted this execution. */
	readonly authorizingPrincipalId: string;
	/** Identifies the immutable authority decision that admitted this execution. */
	readonly decisionEvidenceId: string;
	/** Records when the authority admitted the execution. */
	readonly admittedAt: string;
}

/**
 * Binds the one AgentIdentity and Principal that may exercise an admitted run on one computer.
 *
 * The subject does not branch between people and services. Current identity, membership, and
 * capability evidence bind its principal, run, computer lease, requester, and admission decision
 * before a runtime receives it. The requester may equal the authorizing principal, but the two
 * fields never imply one another.
 */
export interface ExecutionSubject
{
	/** Names this serialized execution-subject contract shape. */
	readonly schemaVersion: 1;
	/** Identifies the silo that owns every subject coordinate and evidence record. */
	readonly siloId: SiloId;
	/** Identifies the one AgentIdentity allowed to exercise this subject. */
	readonly agentIdentityId: string;
	/** Identifies the one current principal realized by the agent identity. */
	readonly principalId: string;
	/** Stores the verified current identity head. */
	readonly identity: ExecutionSubjectIdentityEvidence;
	/** Stores the verified current membership evidence. */
	readonly membership: ExecutionSubjectMembershipEvidence;
	/** Stores the exact admitted capability decision. */
	readonly capability: ExecutionSubjectCapabilityEvidence;
	/** Stores the exact fenced run scope. */
	readonly runScope: ExecutionSubjectRunScope;
	/** Stores the exact fenced conversation-computer scope. */
	readonly computerScope: ExecutionSubjectComputerScope;
	/** Stores the authenticated request provenance. */
	readonly requester: ExecutionSubjectRequesterProvenance;
	/** Stores the distinct admission authority evidence. */
	readonly admission: ExecutionSubjectAdmissionEvidence;
}

/** Trigger that created an agent run. */
export type AgentRunTrigger = "interactive" | "schedule" | "managed_invocation";

/** Stable durable lifecycle vocabulary for one agent-run attempt. */
export enum AgentRunStates
{
	/** Product authority accepted the run. */
	Accepted = "accepted",
	/** Capacity policy queued the run. */
	Queued = "queued",
	/** A workload assignment exists. */
	Assigned = "assigned",
	/** The runtime is actively processing the attempt. */
	Running = "running",
	/** The attempt is paused for governed participant input. */
	WaitingForInput = "waiting_for_input",
	/** Provider ambiguity requires operator recovery. */
	RecoveryRequired = "recovery_required",
	/** Cancellation is requested while the stop signal drains. */
	Cancelling = "cancelling",
	/** The run completed successfully. */
	Completed = "completed",
	/** The run ended in failure. */
	Failed = "failed",
	/** The run ended after cancellation. */
	Cancelled = "cancelled",
}

/** Durable lifecycle state serialized for one agent-run attempt. */
export type AgentRunState = `${AgentRunStates}`;

/** Terminal classification recorded for a finished run. */
export type AgentRunTerminalReason = "success" | "user_cancelled" | "policy_denied" | "budget_exhausted" | "runtime_failure" | "invalid_input";

/** Immutable lineage of a run within a root invocation. */
export interface AgentRunLineage
{
	/** Root run identifier shared by the invocation tree. */
	readonly rootRunId: AgentRunId;
	/** Immediate parent run identifier, or null for the root. */
	readonly parentRunId: AgentRunId | null;
}

/** Durable record of one agent execution attempt. */
export interface AgentRun
{
	/** Stable run identifier. */
	readonly id: AgentRunId;
	/** Silo in which the run and its authorization evidence are valid. */
	readonly siloId: SiloId;
	/** Agent service being executed. */
	readonly agentServiceId: AgentServiceId;
	/** Immutable revision executed by this run. */
	readonly agentRevisionId: AgentRevisionId;
	/** Conversation receiving user-visible output, or null for non-conversational runs. */
	readonly conversationId: ConversationId | null;
	/** Trigger that created the run. */
	readonly trigger: AgentRunTrigger;
	/** Immutable subject whose current evidence admitted this execution. */
	readonly executionSubject: ExecutionSubject;
	/** Idempotency key for the request that created the run. */
	readonly requestIdempotencyKey: string;
	/** Root and parent lineage for delegated or child work. */
	readonly lineage: AgentRunLineage;
	/** One-based attempt number; retries create a new attempt. */
	readonly attempt: number;
	/** Current durable lifecycle state. */
	readonly state: AgentRunState;
	/** Digest of the deterministic RunInputSnapshot assigned to the runtime. */
	readonly inputSnapshotDigest: string;
	/** ISO-8601 instant at which the run was accepted. */
	readonly acceptedAt: string;
	/** ISO-8601 instant at which runtime execution started, or null before start. */
	readonly startedAt: string | null;
	/** ISO-8601 instant at which the run terminated, or null while active. */
	readonly finishedAt: string | null;
	/** Terminal classification, or null while the run remains active. */
	readonly terminalReason: AgentRunTerminalReason | null;
}
