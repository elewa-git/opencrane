import { describe, expect, it } from "vitest";

import { ___ParseAgentControllerSkillWorkloadAssignmentCommand, ___ParseAgentControllerSkillWorkloadAssignmentResult, ___ParseAgentControllerSkillWorkloadClaim, ___ParseAgentControllerSkillWorkloadPodRegistrationCommand, ___ParseAgentControllerSkillWorkloadPodRegistrationResult, ___ParseAgentControllerSkillWorkloadReleaseClaim, ___ParseAgentControllerSkillWorkloadReleaseCommand, ___ParseAgentControllerSkillWorkloadReleaseResult } from "../agent-controller-skill-workload.validator";

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

describe("agent-controller skill-workload contract validators", function _DescribeValidators()
{
	it("strips untrusted response extensions while retaining exact typed claims", function _StripsResponseExtensions()
	{
		expect(___ParseAgentControllerSkillWorkloadClaim(_SkillClaim())).toEqual({ workloadId: "workload-1", siloId: "silo-1", kind: "authoring", skillRevisionId: "revision-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:01:00.000Z" });
		expect(___ParseAgentControllerSkillWorkloadReleaseClaim(_SkillReleaseClaim())).toEqual({ workloadId: "workload-1", siloId: "silo-1", kind: "tool-runner", workloadUid: "job-1", releaseClaimedAt: "2026-07-20T00:02:00.000Z", releaseDeliveryCount: 2, expiresAt: "2026-07-20T00:03:00.000Z" });
	});

	it("rejects unsafe counters and non-canonical instants", function _RejectsInvalidClaims()
	{
		expect(function _UnsafeCounter() { ___ParseAgentControllerSkillWorkloadClaim({ ..._SkillClaim(), deliveryCount: Number.MAX_SAFE_INTEGER + 1 }); }).toThrow("skill workload claim.deliveryCount must be a positive integer");
		expect(function _NonCanonicalInstant() { ___ParseAgentControllerSkillWorkloadReleaseClaim({ ..._SkillReleaseClaim(), expiresAt: "2026-07-20T00:03:00Z" }); }).toThrow("skill workload release claim.expiresAt must be a UTC millisecond instant");
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

	it("binds skill responses to the exact submitted command", function _BindsSkillResults()
	{
		const assignment = { claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-1", bootstrapReference: "bootstrap-1", namespace: "skills" };
		const release = { releaseClaimedAt: "2026-07-20T00:02:00.000Z", releaseDeliveryCount: 2, workloadUid: "job-1" };
		const registration = { ...release, podUid: "pod-1" };
		expect(___ParseAgentControllerSkillWorkloadAssignmentResult({ outcome: "assigned", workloadId: "workload-1", workloadUid: "job-1" }, "workload-1", assignment).outcome).toBe("assigned");
		expect(___ParseAgentControllerSkillWorkloadReleaseResult({ outcome: "released", workloadId: "workload-1", workloadUid: "job-1" }, "workload-1", release).outcome).toBe("released");
		expect(___ParseAgentControllerSkillWorkloadPodRegistrationResult({ outcome: "registered", workloadId: "workload-1", workloadUid: "job-1", podUid: "pod-1" }, "workload-1", registration).outcome).toBe("registered");
		expect(function _MismatchedPod() { ___ParseAgentControllerSkillWorkloadPodRegistrationResult({ outcome: "registered", workloadId: "workload-1", workloadUid: "job-1", podUid: "other" }, "workload-1", registration); }).toThrow("mismatched skill workload Pod-registration result");
	});
});
