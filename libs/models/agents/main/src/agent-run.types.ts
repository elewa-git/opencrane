import type { AgentRevisionId, AgentRunId, AgentServiceId, SiloId, ThreadId, UserId } from "./identifiers.types.js";

/** Trigger that created an agent run. */
export type AgentRunTrigger = "interactive" | "schedule" | "managed_invocation";

/** Durable lifecycle state of an agent run attempt, including nonterminal cleanup after cancellation is requested. */
export type AgentRunState = "accepted" | "queued" | "assigned" | "running" | "waiting_for_approval" | "cancelling" | "completed" | "failed" | "cancelled";

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
	/** Thread receiving user-visible transcript output, or null for non-conversational runs. */
	readonly threadId: ThreadId | null;
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
