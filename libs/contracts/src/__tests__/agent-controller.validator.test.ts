import { describe, expect, it } from "vitest";

import { ___ParseAgentControllerSkillWorkloadAssignmentCommand, ___ParseAgentControllerSkillWorkloadAssignmentResult, ___ParseAgentControllerSkillWorkloadClaim, ___ParseAgentControllerSkillWorkloadPodRegistrationCommand, ___ParseAgentControllerSkillWorkloadPodRegistrationResult, ___ParseAgentControllerSkillWorkloadReleaseClaim, ___ParseAgentControllerSkillWorkloadReleaseCommand, ___ParseAgentControllerSkillWorkloadReleaseResult } from "../agent-controller-skill-workload.validator";
import { ___ParseAgentControllerOutboxPrunedCount, ___ParseAgentControllerRunAttemptAssignmentCommand, ___ParseAgentControllerRunAttemptAssignmentResult, ___ParseAgentControllerRunAttemptClaim, ___ParseAgentControllerRunWorkloadRegistrationCommand, ___ParseAgentControllerRunWorkloadRegistrationResult, ___ParseAgentControllerRunWorkloadReleaseClaim } from "../agent-controller.validator";

/** Return one valid runtime attempt claim with optional untrusted response extensions. */
function _RunClaim()
{
	return {
		lease: { eventId: "event-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:01:00.000Z", ignored: true },
		attempt: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", namespace: "silo-runtime", workloadProfile: "personal-default", bootstrapReference: "bootstrap-1", litellmKey: "transient-key", ignored: true },
		ignored: true,
	};
}

/** Return one valid runtime assignment command. */
function _RunAssignmentCommand()
{
	return { claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, runId: "run-1", attempt: 1, expectedWorkloadProfile: "personal-default", bootstrapReference: "bootstrap-1", namespace: "silo-runtime", serviceAccountName: "agent-runtime", workloadUid: "job-1" };
}

/** Return one valid runtime first-Pod registration command. */
function _RunRegistrationCommand()
{
	return { claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-runtime", serviceAccountName: "agent-runtime", workloadUid: "job-1", workloadProfile: "personal-default", bootstrapReference: "bootstrap-1", podUid: "pod-1" };
}

/** Return one valid governed skill workload claim. */
function _SkillClaim()
{
	return { workloadId: "workload-1", siloId: "silo-1", kind: "authoring", skillRevisionId: "revision-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:01:00.000Z", ignored: true };
}

/** Return one valid governed skill release claim. */
function _SkillReleaseClaim()
{
	return { workloadId: "workload-1", siloId: "silo-1", kind: "tool-runner", workloadUid: "job-1", releaseClaimedAt: "2026-07-20T00:02:00.000Z", releaseDeliveryCount: 2, expiresAt: "2026-07-20T00:03:00.000Z", ignored: true };
}

describe("agent-controller contract validators", function _DescribeValidators()
{
	it("strips untrusted response extensions while retaining exact typed claims", function _StripsResponseExtensions()
	{
		expect(___ParseAgentControllerSkillWorkloadClaim(_SkillClaim())).toEqual({ workloadId: "workload-1", siloId: "silo-1", kind: "authoring", skillRevisionId: "revision-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:01:00.000Z" });
		expect(___ParseAgentControllerSkillWorkloadReleaseClaim(_SkillReleaseClaim())).toEqual({ workloadId: "workload-1", siloId: "silo-1", kind: "tool-runner", workloadUid: "job-1", releaseClaimedAt: "2026-07-20T00:02:00.000Z", releaseDeliveryCount: 2, expiresAt: "2026-07-20T00:03:00.000Z" });
		expect(___ParseAgentControllerRunAttemptClaim(_RunClaim())).toEqual({ lease: { eventId: "event-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:01:00.000Z" }, attempt: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", namespace: "silo-runtime", workloadProfile: "personal-default", bootstrapReference: "bootstrap-1", litellmKey: "transient-key" } });
	});

	it("rejects malformed nested fields, unsafe counters, non-canonical instants, and stale leases", function _RejectsInvalidClaims()
	{
		expect(function _MissingEventId() { ___ParseAgentControllerRunAttemptClaim({ ..._RunClaim(), lease: { ..._RunClaim().lease, eventId: "" } }); }).toThrow("controller claim.lease.eventId must be a bounded identifier");
		expect(function _UnsafeCounter() { ___ParseAgentControllerSkillWorkloadClaim({ ..._SkillClaim(), deliveryCount: Number.MAX_SAFE_INTEGER + 1 }); }).toThrow("skill workload claim.deliveryCount must be a positive integer");
		expect(function _NonCanonicalInstant() { ___ParseAgentControllerSkillWorkloadReleaseClaim({ ..._SkillReleaseClaim(), expiresAt: "2026-07-20T00:03:00Z" }); }).toThrow("skill workload release claim.expiresAt must be a UTC millisecond instant");
		expect(function _StaleLease() { ___ParseAgentControllerRunAttemptClaim({ ..._RunClaim(), lease: { ..._RunClaim().lease, expiresAt: "2026-07-20T00:00:00.000Z" } }); }).toThrow("controller claim.lease must expire after it is claimed");
	});

	it("accepts exact commands and rejects extensions before they reach an authority", function _ValidatesCommands()
	{
		const assignment = _RunAssignmentCommand();
		const registration = _RunRegistrationCommand();
		expect(___ParseAgentControllerRunAttemptAssignmentCommand(assignment)).toEqual(assignment);
		expect(___ParseAgentControllerRunAttemptAssignmentCommand({ ...assignment, policy: "self-asserted" })).toBeNull();
		expect(___ParseAgentControllerRunWorkloadRegistrationCommand(registration)).toEqual(registration);
		expect(___ParseAgentControllerRunWorkloadRegistrationCommand({ ...registration, attempt: 0 })).toBeNull();
	});

	it("validates every governed skill mutation command with strict schemas", function _ValidatesSkillCommands()
	{
		const assignment = { claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-1", bootstrapReference: "bootstrap-1", namespace: "skills" };
		const release = { releaseClaimedAt: "2026-07-20T00:02:00.000Z", releaseDeliveryCount: 2, workloadUid: "job-1" };
		const registration = { ...release, podUid: "pod-1" };
		expect(___ParseAgentControllerSkillWorkloadAssignmentCommand(assignment)).toEqual(assignment);
		expect(___ParseAgentControllerSkillWorkloadReleaseCommand(release)).toEqual(release);
		expect(___ParseAgentControllerSkillWorkloadPodRegistrationCommand(registration)).toEqual(registration);
		expect(___ParseAgentControllerSkillWorkloadPodRegistrationCommand({ ...registration, expiresAt: "self-asserted" })).toBeNull();
	});

	it("binds runtime responses to the exact submitted command", function _BindsRuntimeResults()
	{
		const assignment = _RunAssignmentCommand();
		const registration = _RunRegistrationCommand();
		expect(___ParseAgentControllerRunAttemptAssignmentResult({ outcome: "assigned", runId: assignment.runId, attempt: assignment.attempt, workloadUid: assignment.workloadUid, ignored: true }, assignment)).toEqual({ outcome: "assigned", runId: "run-1", attempt: 1, workloadUid: "job-1" });
		expect(function _MismatchedAssignment() { ___ParseAgentControllerRunAttemptAssignmentResult({ outcome: "assigned", runId: "other", attempt: 1, workloadUid: "job-1" }, assignment); }).toThrow("mismatched controller assignment result");
		expect(___ParseAgentControllerRunWorkloadRegistrationResult({ outcome: "registered", runId: registration.runId, attempt: registration.attempt, workloadUid: registration.workloadUid, podUid: registration.podUid }, registration)).toEqual({ outcome: "registered", runId: "run-1", attempt: 1, workloadUid: "job-1", podUid: "pod-1" });
	});

	it("binds skill responses and bounds outbox maintenance", function _BindsSkillResults()
	{
		const assignment = { claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-1", bootstrapReference: "bootstrap-1", namespace: "skills" };
		const release = { releaseClaimedAt: "2026-07-20T00:02:00.000Z", releaseDeliveryCount: 2, workloadUid: "job-1" };
		const registration = { ...release, podUid: "pod-1" };
		expect(___ParseAgentControllerSkillWorkloadAssignmentResult({ outcome: "assigned", workloadId: "workload-1", workloadUid: "job-1" }, "workload-1", assignment).outcome).toBe("assigned");
		expect(___ParseAgentControllerSkillWorkloadReleaseResult({ outcome: "released", workloadId: "workload-1", workloadUid: "job-1" }, "workload-1", release).outcome).toBe("released");
		expect(___ParseAgentControllerSkillWorkloadPodRegistrationResult({ outcome: "registered", workloadId: "workload-1", workloadUid: "job-1", podUid: "pod-1" }, "workload-1", registration).outcome).toBe("registered");
		expect(function _MismatchedPod() { ___ParseAgentControllerSkillWorkloadPodRegistrationResult({ outcome: "registered", workloadId: "workload-1", workloadUid: "job-1", podUid: "other" }, "workload-1", registration); }).toThrow("mismatched skill workload Pod-registration result");
		expect(___ParseAgentControllerOutboxPrunedCount({ deletedCount: 1_000 })).toBe(1_000);
		expect(function _TooManyRows() { ___ParseAgentControllerOutboxPrunedCount({ deletedCount: 1_001 }); }).toThrow("outbox-prune result.deletedCount must be an integer between 0 and 1000");
	});

	it("parses complete workload-release claims", function _ParsesReleaseClaim()
	{
		const release = { lease: { eventId: "release-1", claimedAt: "2026-07-20T00:02:00.000Z", deliveryCount: 2, expiresAt: "2026-07-20T00:03:00.000Z" }, workload: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-runtime", serviceAccountName: "agent-runtime", workloadUid: "job-1", workloadProfile: "personal-default", assignmentExpiresAt: "2026-07-20T01:00:00.000Z", bootstrapReference: "bootstrap-1" } };
		expect(___ParseAgentControllerRunWorkloadReleaseClaim(release)).toEqual(release);
	});
});
