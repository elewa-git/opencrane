import { AGENT_RUNTIME_PROTOCOL_V1, RuntimeCommandKinds } from "@opencrane/contracts";
import { AgentRunStates } from "@opencrane/models/agents";

import { RuntimeAdmissionOutcomes, type RuntimeAdmissionRunState, type RuntimeCandidateAdmission, type RuntimeCandidateAdmissionInput, type RuntimeCommandAdmission, type RuntimeCommandAdmissionInput } from "./runtime-protocol-authority.types.js";

/** Returns whether a runtime identifier is a string with something in it. */
function _hasIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0;
}

/** Returns whether the value is a positive whole number, as a sequence or fence must be. */
function _hasPositiveCounter(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Returns whether the run's state no longer allows any new command or candidate. */
function _isTerminalForAdmission(state: RuntimeAdmissionRunState): boolean
{
	return state !== "accepted"
		&& state !== "queued"
		&& state !== "assigned"
		&& state !== "running"
		&& state !== "waiting_for_input";
}

/**
 * Parses a timestamp only in the exact form used on the wire: 2026-08-12T09:30:00.000Z.
 * Looser spellings that JavaScript would accept are rejected, so two runtimes cannot write the same
 * instant in different ways and both still pass the expiry check.
 */
function _parseTime(value: unknown): number | null
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
	const epochMs = Date.parse(value);
	return Number.isFinite(epochMs) && new Date(epochMs).toISOString() === value ? epochMs : null;
}

/**
 * Decides whether one command may be sent to the runtime. Reads nothing and writes nothing.
 *
 * All the fencing rules live here, away from Postgres, so they can be tested exhaustively and
 * cannot be bypassed by a transport bug: the command must belong to the current attempt and
 * assignment, carry the attempt's current fence, arrive in sequence, sit inside both its own expiry
 * and the assignment lease, and - for `start_attempt` - carry the snapshot digest the attempt was
 * admitted with.
 *
 * Deciding is not doing. Acceptance grants no write: the caller must save the new sequence number
 * and the command id in the same transaction before the command reaches the runtime, or a crash
 * would let one sequence be issued twice.
 *
 * Called by: `_nextCommand` in prisma-runtime-dispatch-authority.ts, twice - once for a stored
 * command being re-sent, where only `idempotent` is acceptable, and once for a newly built one,
 * where only `accepted` is.
 *
 * @param input - The current attempt authority, the command under test, and the server clock.
 * @returns `accepted` - send it, after saving `nextCommandSequence`. `idempotent` - this exact
 * command id was already accepted, so re-sending the identical body is safe and the sequence must
 * not advance. `denied` - do not send it; `reason` says which check failed.
 * @see __AdmitRuntimeCandidate for the runtime-to-server direction.
 * @see RuntimeAttemptAuthority for what the caller must load first.
 */
export function __AdmitRuntimeCommand(input: RuntimeCommandAdmissionInput): RuntimeCommandAdmission
{
	const { authority, command } = input;
	const issuedAtEpochMs = _parseTime(command.issuedAt);
	const expiresAtEpochMs = _parseTime(command.expiresAt);
	const assignmentExpiresAtEpochMs = _parseTime(command.assignment.expiresAt);
	const nowEpochMs = input.clock.nowEpochMs();

	// 1. Reject a malformed frame before comparing any value an attacker might control.
	if (!_hasIdentifier(command.runtimeInstanceId) || !_hasIdentifier(command.commandId) || !_hasIdentifier(command.assignment.assignmentDigest) || !_hasPositiveCounter(command.sequence) || !_hasPositiveCounter(command.fence) || issuedAtEpochMs === null || expiresAtEpochMs === null || assignmentExpiresAtEpochMs === null || issuedAtEpochMs >= expiresAtEpochMs)
	{
		return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "invalid_frame" };
	}
	if (command.protocolVersion !== AGENT_RUNTIME_PROTOCOL_V1) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "unsupported_protocol" };
	if (nowEpochMs < issuedAtEpochMs) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "not_yet_valid" };
	if (nowEpochMs >= expiresAtEpochMs || nowEpochMs >= assignmentExpiresAtEpochMs) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "expired" };
	if (!Number.isSafeInteger(authority.leaseExpiresAtEpochMs) || nowEpochMs >= authority.leaseExpiresAtEpochMs) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "expired" };
	// A `cancel_attempt` is a positive stop signal, so it is admitted while the run is `cancelling`
	// even though that state is otherwise closed to admission; every other kind stays denied there,
	// and once the run is fully terminal even a cancel is refused. Late candidates are never admitted
	// during `cancelling`, so cancelled work can neither continue nor reopen a terminal run.
	if (_isTerminalForAdmission(authority.runState) && !(authority.runState === AgentRunStates.Cancelling && command.kind === RuntimeCommandKinds.CancelAttempt)) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "terminal_run" };

	// 2. Check the command against the assignment it was issued for and the attempt's current lease.
	if (command.assignment.runId !== authority.runId || command.assignment.attempt !== authority.attempt || command.assignment.assignmentDigest !== authority.assignmentDigest)
	{
		return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "assignment_mismatch" };
	}
	if (assignmentExpiresAtEpochMs > authority.leaseExpiresAtEpochMs) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "assignment_mismatch" };
	if (command.runtimeInstanceId !== authority.runtimeInstanceId) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "runtime_instance_mismatch" };
	if (command.fence !== authority.fence) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "fence_mismatch" };
	if (authority.acceptedCommandIds.includes(command.commandId)) return { outcome: RuntimeAdmissionOutcomes.Idempotent };
	if (command.sequence !== authority.nextCommandSequence) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "sequence_mismatch" };

	// 3. Refuse a start frame whose immutable snapshot differs from the attempt authority.
	if (command.kind === RuntimeCommandKinds.StartAttempt && command.payload.snapshot.digest !== authority.inputSnapshotDigest)
	{
		return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "snapshot_mismatch" };
	}
	return { outcome: RuntimeAdmissionOutcomes.Accepted, nextCommandSequence: authority.nextCommandSequence + 1 };
}

/**
 * Decides whether something the runtime proposes may be recorded. Reads nothing and writes nothing.
 *
 * The candidate must name the current run and attempt, come from the runtime instance bound to the
 * stream, carry the attempt's current fence, and refer to a command that was actually accepted -
 * which is what stops a runtime inventing work it was never asked to do.
 *
 * Acceptance is not permission to perform the effect. It only means the proposal is well-formed
 * and current; the event or external-action code that owns the effect must still validate it and
 * save it.
 *
 * Called by: `_admitCandidate` in prisma-runtime-dispatch-authority.ts.
 *
 * @param input - The current attempt authority, the candidate under test, and the server clock.
 * @returns `accepted` - go on to validate and save the effect. `idempotent` - this candidate id was
 * accepted before, so the caller must check the repeat is identical (for an external action, that
 * its arguments still match) and refuse it otherwise. `denied` - the runtime must not perform the
 * effect; `reason` says why.
 * @see __AdmitRuntimeCommand for the server-to-runtime direction.
 */
export function __AdmitRuntimeCandidate(input: RuntimeCandidateAdmissionInput): RuntimeCandidateAdmission
{
	const { authority, candidate } = input;

	// 1. Reject a malformed candidate before it reaches the event or external-action code.
	if (!_hasIdentifier(candidate.runtimeInstanceId) || !_hasIdentifier(candidate.commandId) || !_hasIdentifier(candidate.candidateId) || !_hasPositiveCounter(candidate.attempt) || !_hasPositiveCounter(candidate.fence))
	{
		return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "invalid_candidate" };
	}
	if (candidate.protocolVersion !== AGENT_RUNTIME_PROTOCOL_V1) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "unsupported_protocol" };
	if (_isTerminalForAdmission(authority.runState)) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "terminal_run" };
	if (!Number.isSafeInteger(authority.leaseExpiresAtEpochMs) || input.clock.nowEpochMs() >= authority.leaseExpiresAtEpochMs) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "expired" };

	// 2. Require the exact current stream and attempt rather than accepting a stale runtime reconnect.
	if (candidate.runId !== authority.runId || candidate.attempt !== authority.attempt) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "assignment_mismatch" };
	if (candidate.runtimeInstanceId !== authority.runtimeInstanceId) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "runtime_instance_mismatch" };
	if (candidate.fence !== authority.fence) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "fence_mismatch" };
	if (!authority.acceptedCommandIds.includes(candidate.commandId)) return { outcome: RuntimeAdmissionOutcomes.Denied, reason: "command_not_accepted" };
	if (authority.acceptedCandidateIds.includes(candidate.candidateId)) return { outcome: RuntimeAdmissionOutcomes.Idempotent };
	return { outcome: RuntimeAdmissionOutcomes.Accepted };
}
