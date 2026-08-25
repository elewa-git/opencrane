import { describe, expect, it } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ArtifactPreprocessTaskDeclaration, ArtifactPreprocessTaskNames } from "../index";
import type { ArtifactPreprocessControllerRecord } from "../index";

describe("artifact preprocess task contract", function _DescribeArtifactPreprocessTaskContract()
{
	it("keeps the declaration bound to the supported PDF task name", function _UsesPdfTaskName()
	{
		expect(ArtifactPreprocessTaskDeclaration.taskName).toBe(ArtifactPreprocessTaskNames.Convert);
	});

	it("gives the controller a PDF-specific workload claim", function _ControllerRecord()
	{
		const record = {
			preprocessJobId: "preprocess-1",
			siloId: "silo-1",
			claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: RuntimeWorkloadClaimClasses.ArtifactPreprocess, profileName: "pdf-preprocessor", idempotencyKey: "workflows:artifact-preprocess:abc", claimedAt: "2026-08-25T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T00:01:00.000Z", executionReference: "preprocess-1" },
		} satisfies ArtifactPreprocessControllerRecord;

		expect(record.claim.workloadClass).toBe(RuntimeWorkloadClaimClasses.ArtifactPreprocess);
	});
});
