import type { RuntimeCandidate, RuntimeCommandEnvelope } from "@opencrane/contracts";
import type { AgentRunId, AgentRunState } from "@opencrane/models/agents";

/** Run lifecycle values relevant to runtime admission, including the cancellation drain state. */
export type RuntimeAdmissionRunState = AgentRunState;

/** Current immutable authority facts for one active runtime attempt. */
export interface RuntimeAttemptAuthority
{
	/** Run to which every accepted frame must be bound. */
	readonly runId: AgentRunId;
	/** Current attempt number for the run. */
	readonly attempt: number;
	/** Current server-owned lease fence. */
	readonly fence: number;
	/** Digest of the exact workload assignment accepted at dispatch. */
	readonly assignmentDigest: string;
	/** Digest of the immutable snapshot assigned to the attempt. */
	readonly inputSnapshotDigest: string;
	/** Runtime instance bound to the currently open stream. */
	readonly runtimeInstanceId: string;
	/** Next command sequence required on this stream. */
	readonly nextCommandSequence: number;
	/** Already accepted command ids, retained only through the attempt lease. */
	readonly acceptedCommandIds: readonly string[];
	/** Already accepted candidate ids, retained at the durable attempt fence for replay safety. */
	readonly acceptedCandidateIds: readonly string[];
	/** Trusted hard lease expiry for this runtime attempt. */
	readonly leaseExpiresAtEpochMs: number;
	/** Current durable run state; Cancelling closes admission like a terminal state. */
	readonly runState: RuntimeAdmissionRunState;
}

/** Server-owned time source for deterministic runtime-frame validation. */
export interface RuntimeProtocolClock
{
	/** Returns the trusted current epoch milliseconds. */
	nowEpochMs(): number;
}

/** Stable command-admission outcome for a runtime frame. */
export type RuntimeCommandAdmission =
	| { readonly outcome: "accepted"; readonly nextCommandSequence: number }
	| { readonly outcome: "idempotent" }
	| { readonly outcome: "denied"; readonly reason: "invalid_frame" | "unsupported_protocol" | "not_yet_valid" | "expired" | "assignment_mismatch" | "runtime_instance_mismatch" | "fence_mismatch" | "sequence_mismatch" | "terminal_run" | "snapshot_mismatch" };

/** Stable candidate-admission outcome for a runtime-proposed side-effect or event. */
export type RuntimeCandidateAdmission =
	| { readonly outcome: "accepted" }
	| { readonly outcome: "idempotent" }
	| { readonly outcome: "denied"; readonly reason: "invalid_candidate" | "unsupported_protocol" | "expired" | "assignment_mismatch" | "runtime_instance_mismatch" | "fence_mismatch" | "command_not_accepted" | "terminal_run" };

/** Input boundary for an attempted runtime command admission. */
export interface RuntimeCommandAdmissionInput
{
	/** Current durable attempt authority loaded at the final admission fence. */
	readonly authority: RuntimeAttemptAuthority;
	/** Runtime command frame under validation. */
	readonly command: RuntimeCommandEnvelope;
	/** Trusted server clock rather than a runtime-supplied time. */
	readonly clock: RuntimeProtocolClock;
}

/** Input boundary for an attempted runtime candidate admission. */
export interface RuntimeCandidateAdmissionInput
{
	/** Current durable attempt authority loaded at the final admission fence. */
	readonly authority: RuntimeAttemptAuthority;
	/** Runtime-proposed candidate under validation. */
	readonly candidate: RuntimeCandidate;
	/** Trusted server clock rather than a runtime-supplied time. */
	readonly clock: RuntimeProtocolClock;
}
