import { AGENT_RUNTIME_PROTOCOL_V1, type CompiledRunInput, type RunInputSnapshot, type RuntimeCandidate, type RuntimeCommandEnvelope } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { __AdmitRuntimeCandidate, __AdmitRuntimeCommand } from "../index.js";
import type { RuntimeAttemptAuthority } from "../index.js";

/** Returns one current attempt authority for protocol-boundary tests. */
function _authority(): RuntimeAttemptAuthority
{
	return {
		runId: "run-1",
		attempt: 2,
		fence: 7,
		assignmentDigest: "sha256:assignment",
		inputSnapshotDigest: "sha256:snapshot",
		runtimeInstanceId: "runtime-1",
		nextCommandSequence: 3,
		acceptedCommandIds: [],
		acceptedCandidateIds: [],
		leaseExpiresAtEpochMs: Date.parse("2026-07-20T00:05:00.000Z"),
		runState: "running",
	};
}

/** Start-command specialization that preserves the snapshot payload in protocol tests. */
type RuntimeStartAttemptCommand = Extract<RuntimeCommandEnvelope, { readonly kind: "start_attempt" }>;

/** Returns the canonical input snapshot for a start command. */
function _snapshot(): RunInputSnapshot
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "agent-1", agentRevisionId: "revision-1", snapshotVersion: 1, threadId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryFacts: [], memoryQueryPolicy: {}, toolGrantIds: [], modelRoute: {}, budgetPolicy: {}, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: "sha256:membership", fleetMembershipTrustedUntil: "2026-07-20T00:05:00.000Z" }, capabilitySetDigest: "sha256:capabilities", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", digest: "sha256:snapshot", compiledAt: "2026-07-20T00:00:00.000Z" };
}

/** Returns the compiled literal input carried alongside the snapshot on a start command. */
function _compiledInput(): CompiledRunInput
{
	return { promptCompilerVersion: "v1", runId: "run-1", attempt: 1, instructions: "", messages: [], tools: [], model: { modelAlias: "silo-default", maxOutputTokens: null }, budget: { maxTotalTokens: null, maxCostUsdMicros: null, maxToolInvocations: null, wallClockDeadlineEpochMs: null }, digest: "sha256:compiled" };
}

/** Returns a valid start command bound to the current authority. */
function _command(): RuntimeStartAttemptCommand
{
	return {
		protocolVersion: AGENT_RUNTIME_PROTOCOL_V1,
		runtimeInstanceId: "runtime-1",
		commandId: "command-1",
		sequence: 3,
		fence: 7,
		issuedAt: "2026-07-20T00:00:00.000Z",
		expiresAt: "2026-07-20T00:05:00.000Z",
		assignment: { runId: "run-1", attempt: 2, agentServiceId: "agent-1", agentRevisionId: "revision-1", siloId: "silo-1", subjectUserId: "user-1", fleetMembershipRevision: 1, capabilitySetDigest: "sha256:capabilities", serviceAccountName: "runtime", podUid: "pod-1", assignmentDigest: "sha256:assignment", issuedAt: "2026-07-20T00:00:00.000Z", expiresAt: "2026-07-20T00:05:00.000Z" },
		kind: "start_attempt",
		payload: { snapshot: _snapshot(), compiledInput: _compiledInput() },
	};
}

/** Returns a valid runtime event candidate for the current authority. */
function _candidate(): RuntimeCandidate
{
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 2, fence: 7, kind: "event", eventType: "run.started", payload: {} };
}

/** Returns a valid external-action candidate for the current authority. */
function _actionCandidate(): RuntimeCandidate
{
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "action-1", runId: "run-1", attempt: 2, fence: 7, kind: "external_action", toolRevisionId: "tool-1", toolInvocationId: "invocation-1", argumentsDigest: "sha256:arguments", arguments: {} };
}

describe("runtime protocol authority", function _describeRuntimeProtocolAuthority()
{
	it("accepts the exact current start command and advances its required sequence", function _acceptsCurrentStartCommand()
	{
		expect(__AdmitRuntimeCommand({ authority: _authority(), command: _command(), clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "accepted", nextCommandSequence: 4 });
	});

	it("makes a duplicate command idempotent before sequence evaluation", function _deduplicatesCommand()
	{
		const authority = { ..._authority(), acceptedCommandIds: ["command-1"] };
		expect(__AdmitRuntimeCommand({ authority, command: _command(), clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "idempotent" });
	});

	it("rejects stale fences and mismatched snapshots", function _rejectsStaleAuthority()
	{
		expect(__AdmitRuntimeCommand({ authority: _authority(), command: { ..._command(), fence: 6 }, clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "fence_mismatch" });
		expect(__AdmitRuntimeCommand({ authority: _authority(), command: { ..._command(), payload: { snapshot: { ..._command().payload.snapshot, digest: "sha256:other" }, compiledInput: _compiledInput() } }, clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "snapshot_mismatch" });
	});

	it("rejects non-canonical timestamp spellings even when JavaScript can parse them", function _rejectsAmbiguousTime()
	{
		const command = { ..._command(), issuedAt: "2026-07-20T00:00:00Z" };
		expect(__AdmitRuntimeCommand({ authority: _authority(), command, clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "invalid_frame" });
	});

	it("rejects a command before its server-issued validity instant", function _rejectsFutureCommand()
	{
		const command = { ..._command(), issuedAt: "2026-07-20T00:04:00.000Z" };
		expect(__AdmitRuntimeCommand({ authority: _authority(), command, clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "not_yet_valid" });
	});

	it("rejects expired commands and candidates from an older lease", function _rejectsExpiredOrStaleFrames()
	{
		expect(__AdmitRuntimeCommand({ authority: _authority(), command: _command(), clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:05:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "expired" });
		expect(__AdmitRuntimeCandidate({ authority: _authority(), candidate: { ..._candidate(), fence: 6 }, clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "fence_mismatch" });
	});

	it("rejects a fresh command after the trusted attempt lease expires", function _rejectsExpiredAttemptLease()
	{
		const authority = { ..._authority(), leaseExpiresAtEpochMs: Date.parse("2026-07-20T00:01:00.000Z") };
		expect(__AdmitRuntimeCommand({ authority, command: _command(), clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "expired" });
	});

	it.each(["cancelling", "completed", "failed", "cancelled"] as const)("uses terminal_run denial for commands and candidates while the run is %s", function _rejectsClosedRunState(runState)
	{
		const authority = { ..._authority(), runState, acceptedCommandIds: ["command-1"] };
		const clock = { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } };

		expect(__AdmitRuntimeCommand({ authority, command: _command(), clock })).toEqual({ outcome: "denied", reason: "terminal_run" });
		expect(__AdmitRuntimeCandidate({ authority, candidate: _candidate(), clock })).toEqual({ outcome: "denied", reason: "terminal_run" });
		expect(__AdmitRuntimeCandidate({ authority, candidate: _actionCandidate(), clock })).toEqual({ outcome: "denied", reason: "terminal_run" });
	});

	it("rejects a command after its assignment expires before the attempt lease", function _rejectsExpiredAssignment()
	{
		const command = { ..._command(), assignment: { ..._command().assignment, expiresAt: "2026-07-20T00:01:00.000Z" } };
		expect(__AdmitRuntimeCommand({ authority: _authority(), command, clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:02:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "expired" });
	});

	it("accepts candidates only for dispatched commands and deduplicates their ids", function _requiresDispatchedCommands()
	{
		const clock = { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } };
		expect(__AdmitRuntimeCandidate({ authority: _authority(), candidate: _candidate(), clock })).toEqual({ outcome: "denied", reason: "command_not_accepted" });
		expect(__AdmitRuntimeCandidate({ authority: { ..._authority(), acceptedCommandIds: ["command-1"] }, candidate: _candidate(), clock })).toEqual({ outcome: "accepted" });
		expect(__AdmitRuntimeCandidate({ authority: { ..._authority(), acceptedCommandIds: ["command-1"], acceptedCandidateIds: ["candidate-1"] }, candidate: _candidate(), clock })).toEqual({ outcome: "idempotent" });
	});

	it("fails closed for expired and malformed candidate frames", function _rejectsExpiredOrMalformedCandidates()
	{
		const authority = { ..._authority(), acceptedCommandIds: ["command-1"] };
		expect(__AdmitRuntimeCandidate({ authority, candidate: _candidate(), clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:05:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "expired" });
		const malformed = { ..._candidate(), runtimeInstanceId: null } as unknown as RuntimeCandidate;
		expect(__AdmitRuntimeCandidate({ authority, candidate: malformed, clock: { nowEpochMs: function _nowEpochMs(): number { return Date.parse("2026-07-20T00:01:00.000Z"); } } })).toEqual({ outcome: "denied", reason: "invalid_candidate" });
	});
});
