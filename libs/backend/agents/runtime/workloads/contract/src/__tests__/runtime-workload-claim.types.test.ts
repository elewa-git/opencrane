import { describe, expect, it } from "vitest";

import { RuntimeWorkloadClaimClasses } from "../index";
import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "../index";

describe("runtime workload claim contract", function _DescribeRuntimeWorkloadClaimContract()
{
	it("keeps the common claim free of executor-specific fields", function _KeepsClaimGeneric()
	{
		const claim = {
			claimId: "claim-1",
			siloId: "silo-1",
			workloadClass: RuntimeWorkloadClaimClasses.McpExecutor,
			profileName: "mcp-isolated",
			idempotencyKey: "mcp-runtime:server-1",
			claimedAt: "2026-08-25T00:00:00.000Z",
			deliveryCount: 1,
			expiresAt: "2026-08-25T00:01:00.000Z",
			executionReference: "mcp-runtime-1",
		} satisfies RuntimeWorkloadClaim;
		const binding: RuntimeWorkloadBinding = {
			claimId: claim.claimId,
			claimedAt: claim.claimedAt,
			deliveryCount: claim.deliveryCount,
			profileName: claim.profileName,
			workloadUid: "job-uid-1",
		};

		expect(claim.workloadClass).toBe(RuntimeWorkloadClaimClasses.McpExecutor);
		expect(binding.firstPodUid).toBeUndefined();
	});

	it("names PDF preprocessing as a distinct executor class", function _ArtifactPreprocess()
	{
		expect(RuntimeWorkloadClaimClasses.ArtifactPreprocess).toBe("artifact-preprocess");
	});
});
