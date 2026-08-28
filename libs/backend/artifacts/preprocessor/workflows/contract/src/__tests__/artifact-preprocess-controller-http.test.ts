import { describe, expect, it } from "vitest";

import { __ParseArtifactPreprocessRecoveryRequest, __ParseArtifactPreprocessWorkloadBindRequest, ArtifactPreprocessRecoveryReasons, ArtifactPreprocessTaskNames } from "../index";

/** Returns the saved task receipt that may bind the selected PDF preprocessing Job. */
function _Task()
{
	return { taskId: "task-1", taskName: ArtifactPreprocessTaskNames.Convert, idempotencyKey: `workflows:artifact-preprocess:${"a".repeat(64)}` };
}

/** Returns the delivery fence and Job identity sent by the controller. */
function _Binding()
{
	return { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "pdf-preprocessor", workloadUid: "job-uid-1" };
}

describe("artifact preprocessing controller HTTP contract", function _DescribeArtifactPreprocessControllerHttp()
{
	it("rejects a bootstrap reference that the PDF worker cannot consume", function _RejectsInvalidBootstrapReference()
	{
		const request = { task: _Task(), binding: _Binding(), bootstrapReference: "not-a-bootstrap-reference", namespace: "opencrane-artifact-preprocessor" };

		expect(__ParseArtifactPreprocessWorkloadBindRequest(request, "opencrane-artifact-preprocessor")).toBeNull();
	});

	it("requires the exact first Pod and a controller-owned recovery reason", function _ParsesRecovery()
	{
		const binding = { ..._Binding(), firstPodUid: "pod-uid-1" };
		const request = { task: _Task(), binding, reason: ArtifactPreprocessRecoveryReasons.JobTerminalWithoutOutcome };

		expect(__ParseArtifactPreprocessRecoveryRequest(request)).toEqual({ task: _Task(), command: { binding, reason: ArtifactPreprocessRecoveryReasons.JobTerminalWithoutOutcome } });
		expect(__ParseArtifactPreprocessRecoveryRequest({ ...request, binding: _Binding() })).toBeNull();
		expect(__ParseArtifactPreprocessRecoveryRequest({ ...request, reason: "conversion_failed" })).toBeNull();
	});
});
