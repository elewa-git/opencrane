import type { RuntimeCandidate, RuntimeCommandEnvelope } from "@opencrane/contracts";
import type { AgentRunId, AgentRunState } from "@opencrane/models/agents";

/** The run states runtime admission cares about, including Cancelling. */
export type RuntimeAdmissionRunState = AgentRunState;

/**
 * What the server currently knows about one live runtime attempt, and checks every frame against.
 *
 * The caller must build this inside the transaction that holds the run and assignment locks, and
 * pass it straight to {@link __AdmitRuntimeCommand} or {@link __AdmitRuntimeCandidate}. Those
 * functions read nothing themselves, so a stale value here silently weakens every fence they
 * enforce - which is why it is assembled once per poll and never cached between polls.
 *
 * Called by: built by `_buildAuthority` in prisma-runtime-dispatch-authority.ts.
 */
export interface RuntimeAttemptAuthority
{
	/** Run to which every accepted frame must be bound. */
	readonly runId: AgentRunId;
	/** Current attempt number for the run. */
	readonly attempt: number;
	/** Current server-owned lease fence. */
	readonly fence: number;
	/** Digest of the workload assignment this attempt was dispatched with. */
	readonly assignmentDigest: string;
	/** Digest of the immutable snapshot assigned to the attempt. */
	readonly inputSnapshotDigest: string;
	/** Runtime instance bound to the currently open stream. */
	readonly runtimeInstanceId: string;
	/** Next command sequence required on this stream. */
	readonly nextCommandSequence: number;
	/** Command ids already accepted; kept only for as long as the attempt lease lasts. */
	readonly acceptedCommandIds: readonly string[];
	/** Candidate ids already accepted; stored with the attempt so a repeated candidate is recognised. */
	readonly acceptedCandidateIds: readonly string[];
	/** Trusted hard lease expiry for this runtime attempt. */
	readonly leaseExpiresAtEpochMs: number;
	/** The run's current saved state. Cancelling blocks new work just as a finished state does. */
	readonly runState: RuntimeAdmissionRunState;
}

/** Server clock used to check command expiry, so a test can fix the time. */
export interface RuntimeProtocolClock
{
	/** Returns the trusted current epoch milliseconds. */
	nowEpochMs(): number;
}

/** What checking one runtime command returns. */
export type RuntimeCommandAdmission =
	| { readonly outcome: "accepted"; readonly nextCommandSequence: number }
	| { readonly outcome: "idempotent" }
	| { readonly outcome: "denied"; readonly reason: "invalid_frame" | "unsupported_protocol" | "not_yet_valid" | "expired" | "assignment_mismatch" | "runtime_instance_mismatch" | "fence_mismatch" | "sequence_mismatch" | "terminal_run" | "snapshot_mismatch" };

/** What checking one runtime-proposed action or event returns. */
export type RuntimeCandidateAdmission =
	| { readonly outcome: "accepted" }
	| { readonly outcome: "idempotent" }
	| { readonly outcome: "denied"; readonly reason: "invalid_candidate" | "unsupported_protocol" | "expired" | "assignment_mismatch" | "runtime_instance_mismatch" | "fence_mismatch" | "command_not_accepted" | "terminal_run" };

/** Everything `__AdmitRuntimeCommand` needs in order to decide. */
export interface RuntimeCommandAdmissionInput
{
	/** What the server knows about the attempt, read inside the transaction that makes the decision. */
	readonly authority: RuntimeAttemptAuthority;
	/** Runtime command frame under validation. */
	readonly command: RuntimeCommandEnvelope;
	/** Trusted server clock rather than a runtime-supplied time. */
	readonly clock: RuntimeProtocolClock;
}

/** Everything `__AdmitRuntimeCandidate` needs in order to decide. */
export interface RuntimeCandidateAdmissionInput
{
	/** What the server knows about the attempt, read inside the transaction that makes the decision. */
	readonly authority: RuntimeAttemptAuthority;
	/** Runtime-proposed candidate under validation. */
	readonly candidate: RuntimeCandidate;
	/** Trusted server clock rather than a runtime-supplied time. */
	readonly clock: RuntimeProtocolClock;
}
