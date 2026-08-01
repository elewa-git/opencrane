import { AGENT_RUNTIME_PROTOCOL_V1 } from "@opencrane/contracts";

import type { RuntimeAdmissionRunState, RuntimeCandidateAdmission, RuntimeCandidateAdmissionInput, RuntimeCommandAdmission, RuntimeCommandAdmissionInput } from "./runtime-protocol-authority.types.js";

/** Returns whether a runtime identifier is structurally usable at a security boundary. */
function _hasIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0;
}

/** Returns whether a positive, safe integer can represent a protocol sequence or fence. */
function _hasPositiveCounter(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Returns whether the durable run lifecycle has closed all new runtime admission. */
function _isTerminalForAdmission(state: RuntimeAdmissionRunState): boolean
{
	return state !== "accepted"
		&& state !== "queued"
		&& state !== "assigned"
		&& state !== "running"
		&& state !== "waiting_for_approval";
}

/**
 * Parses only the canonical millisecond UTC wire spelling used by signed and digested frames.
 * Permissive JavaScript date spellings are rejected so two runtimes cannot encode one instant
 * differently while still passing the expiry fence.
 */
function _parseTime(value: unknown): number | null
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
	const epochMs = Date.parse(value);
	return Number.isFinite(epochMs) && new Date(epochMs).toISOString() === value ? epochMs : null;
}

/**
 * Admits one runtime command only when its stream, attempt, expiry, fence, and snapshot still match.
 * This is a pure decision boundary: acceptance grants no write and the caller must durably advance
 * sequence/idempotency authority before delivering the command to an executor.
 */
export function __AdmitRuntimeCommand(input: RuntimeCommandAdmissionInput): RuntimeCommandAdmission
{
	const { authority, command } = input;
	const issuedAtEpochMs = _parseTime(command.issuedAt);
	const expiresAtEpochMs = _parseTime(command.expiresAt);
	const assignmentExpiresAtEpochMs = _parseTime(command.assignment.expiresAt);
	const nowEpochMs = input.clock.nowEpochMs();

	// 1. Reject malformed protocol coordinates before comparing potentially attacker-controlled values.
	if (!_hasIdentifier(command.runtimeInstanceId) || !_hasIdentifier(command.commandId) || !_hasIdentifier(command.assignment.assignmentDigest) || !_hasPositiveCounter(command.sequence) || !_hasPositiveCounter(command.fence) || issuedAtEpochMs === null || expiresAtEpochMs === null || assignmentExpiresAtEpochMs === null || issuedAtEpochMs >= expiresAtEpochMs)
	{
		return { outcome: "denied", reason: "invalid_frame" };
	}
	if (command.protocolVersion !== AGENT_RUNTIME_PROTOCOL_V1) return { outcome: "denied", reason: "unsupported_protocol" };
	if (nowEpochMs < issuedAtEpochMs) return { outcome: "denied", reason: "not_yet_valid" };
	if (nowEpochMs >= expiresAtEpochMs || nowEpochMs >= assignmentExpiresAtEpochMs) return { outcome: "denied", reason: "expired" };
	if (!Number.isSafeInteger(authority.leaseExpiresAtEpochMs) || nowEpochMs >= authority.leaseExpiresAtEpochMs) return { outcome: "denied", reason: "expired" };
	// A `cancel_attempt` is a positive stop signal, so it is admitted while the run is `cancelling`
	// even though that state is otherwise closed to admission; every other kind stays denied there,
	// and once the run is fully terminal even a cancel is refused. Late candidates are never admitted
	// during `cancelling`, so cancelled work can neither continue nor reopen a terminal run.
	if (_isTerminalForAdmission(authority.runState) && !(authority.runState === "cancelling" && command.kind === "cancel_attempt")) return { outcome: "denied", reason: "terminal_run" };

	// 2. Bind the stream frame to the dispatch-time assignment and current attempt lease.
	if (command.assignment.runId !== authority.runId || command.assignment.attempt !== authority.attempt || command.assignment.assignmentDigest !== authority.assignmentDigest)
	{
		return { outcome: "denied", reason: "assignment_mismatch" };
	}
	if (assignmentExpiresAtEpochMs > authority.leaseExpiresAtEpochMs) return { outcome: "denied", reason: "assignment_mismatch" };
	if (command.runtimeInstanceId !== authority.runtimeInstanceId) return { outcome: "denied", reason: "runtime_instance_mismatch" };
	if (command.fence !== authority.fence) return { outcome: "denied", reason: "fence_mismatch" };
	if (authority.acceptedCommandIds.includes(command.commandId)) return { outcome: "idempotent" };
	if (command.sequence !== authority.nextCommandSequence) return { outcome: "denied", reason: "sequence_mismatch" };

	// 3. Refuse a start frame whose immutable snapshot differs from the attempt authority.
	if (command.kind === "start_attempt" && command.payload.snapshot.digest !== authority.inputSnapshotDigest)
	{
		return { outcome: "denied", reason: "snapshot_mismatch" };
	}
	return { outcome: "accepted", nextCommandSequence: authority.nextCommandSequence + 1 };
}

/**
 * Admits a runtime proposal only when it remains bound to an accepted command and live attempt fence.
 * Acceptance is not permission to perform the proposed effect; the owning event or action authority
 * must still validate and persist it, while duplicate candidate identifiers remain idempotent.
 */
export function __AdmitRuntimeCandidate(input: RuntimeCandidateAdmissionInput): RuntimeCandidateAdmission
{
	const { authority, candidate } = input;

	// 1. Reject malformed candidate identity before it reaches event or external-action authority.
	if (!_hasIdentifier(candidate.runtimeInstanceId) || !_hasIdentifier(candidate.commandId) || !_hasIdentifier(candidate.candidateId) || !_hasPositiveCounter(candidate.attempt) || !_hasPositiveCounter(candidate.fence))
	{
		return { outcome: "denied", reason: "invalid_candidate" };
	}
	if (candidate.protocolVersion !== AGENT_RUNTIME_PROTOCOL_V1) return { outcome: "denied", reason: "unsupported_protocol" };
	if (_isTerminalForAdmission(authority.runState)) return { outcome: "denied", reason: "terminal_run" };
	if (!Number.isSafeInteger(authority.leaseExpiresAtEpochMs) || input.clock.nowEpochMs() >= authority.leaseExpiresAtEpochMs) return { outcome: "denied", reason: "expired" };

	// 2. Require the exact current stream and attempt rather than accepting a stale runtime reconnect.
	if (candidate.runId !== authority.runId || candidate.attempt !== authority.attempt) return { outcome: "denied", reason: "assignment_mismatch" };
	if (candidate.runtimeInstanceId !== authority.runtimeInstanceId) return { outcome: "denied", reason: "runtime_instance_mismatch" };
	if (candidate.fence !== authority.fence) return { outcome: "denied", reason: "fence_mismatch" };
	if (!authority.acceptedCommandIds.includes(candidate.commandId)) return { outcome: "denied", reason: "command_not_accepted" };
	if (authority.acceptedCandidateIds.includes(candidate.candidateId)) return { outcome: "idempotent" };
	return { outcome: "accepted" };
}
