import { describe, expect, it } from "vitest";

import { __ParseMcpOciServerPromotionCommand, __ParseMcpRuntimeAssignment, __ParseMcpRuntimeCleanupCommand, __ParseMcpRuntimePodRegistrationCommand, __ParseMcpRuntimeReleaseCommand } from "../mcp-runtime-wire";

const _RELEASE = { releaseClaimedAt: "2026-08-26T10:00:00.000Z", releaseDeliveryCount: 2, workloadUid: "job-uid" };
const _CLEANUP = { cleanupClaimedAt: "2026-08-26T10:01:00.000Z", cleanupDeliveryCount: 3, workloadUid: "job-uid" };

describe("MCP runtime wire validation", function _Suite()
{
	it("accepts only bounded promotion fields", function _Promotion()
	{
		expect(__ParseMcpOciServerPromotionCommand({ name: "  Search  ", description: "  Company search  " })).toEqual({ name: "Search", description: "Company search" });
		expect(function _Extra() { __ParseMcpOciServerPromotionCommand({ name: "Search", description: "", registryReference: "caller-controlled" }); }).toThrow(/invalid shape/u);
		expect(function _Blank() { __ParseMcpOciServerPromotionCommand({ name: " ", description: "" }); }).toThrow(/invalid shape/u);
		expect(function _ControlCharacter() { __ParseMcpOciServerPromotionCommand({ name: "\nSearch", description: "" }); }).toThrow(/invalid shape/u);
	});

	it("binds an assignment body to its route claim ID", function _Assignment()
	{
		const body = { claimId: "claim-1", claimedAt: "2026-08-26T10:00:00.000Z", deliveryCount: 1, profileName: "default", workloadUid: "job-uid" };
		expect(__ParseMcpRuntimeAssignment("claim-1", body)).toEqual(body);
		expect(function _Mismatch() { __ParseMcpRuntimeAssignment("claim-2", body); }).toThrow(/invalid shape/u);
		expect(function _Injected() { __ParseMcpRuntimeAssignment("claim-1", { ...body, siloId: "spoofed" }); }).toThrow(/invalid shape/u);
	});

	it("keeps release and Pod evidence exact and independently fenced", function _ReleaseAndPod()
	{
		expect(__ParseMcpRuntimeReleaseCommand(_RELEASE)).toEqual(_RELEASE);
		expect(__ParseMcpRuntimePodRegistrationCommand({ ..._RELEASE, podUid: "pod-uid" })).toEqual({ ..._RELEASE, podUid: "pod-uid" });
		expect(function _StaleShape() { __ParseMcpRuntimeReleaseCommand({ ..._RELEASE, releaseDeliveryCount: 0 }); }).toThrow(/invalid shape/u);
		expect(function _MissingPod() { __ParseMcpRuntimePodRegistrationCommand(_RELEASE); }).toThrow(/invalid shape/u);
	});

	it("keeps terminal cleanup evidence separate from the release fence", function _Cleanup()
	{
		expect(__ParseMcpRuntimeCleanupCommand(_CLEANUP)).toEqual(_CLEANUP);
		expect(function _ReleaseField() { __ParseMcpRuntimeCleanupCommand({ ..._CLEANUP, releaseDeliveryCount: 3 }); }).toThrow(/invalid shape/u);
		expect(function _MissingGeneration() { __ParseMcpRuntimeCleanupCommand({ cleanupClaimedAt: _CLEANUP.cleanupClaimedAt, workloadUid: _CLEANUP.workloadUid }); }).toThrow(/invalid shape/u);
	});
});
