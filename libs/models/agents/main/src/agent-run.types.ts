import type { ConversationId } from "@opencrane/models/conversations";
import type { AgentRevisionId, AgentRunId, AgentServiceId, SiloId, UserId } from "./identifiers.types.js";

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
	/** Delegated interactive user, or null when the service acts as itself. */
	readonly delegatedUserId: UserId | null;
	/** Idempotency key for the request that created the run. */
	readonly requestIdempotencyKey: string;
	/** Root and parent lineage for delegated or child work. */
	readonly lineage: AgentRunLineage;
	/** One-based attempt number; retries create a new attempt. */
	readonly attempt: number;
	/** Current durable lifecycle state. */
	readonly state: AgentRunState;
	/** Digest of the immutable effective authorization and execution contract. */
	readonly effectiveContractDigest: string;
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
