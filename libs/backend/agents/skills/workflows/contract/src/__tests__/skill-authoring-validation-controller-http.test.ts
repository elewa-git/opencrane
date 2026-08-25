import { describe, expect, it } from "vitest";

import { __ParseSkillAuthoringValidationCompletionRequest, __ParseSkillAuthoringValidationWorkloadBindRequest, SkillAuthoringValidationTaskNames } from "../index";

/** Returns one receipt that admission saved for the supported validation task. */
function _Task()
{
	return { taskId: "task-1", taskName: SkillAuthoringValidationTaskNames.Validate, idempotencyKey: `workflows:skill-authoring-validation:${"a".repeat(64)}` };
}

/** Returns one controller delivery fence that can bind a suspended authoring Job. */
function _Binding()
{
	return { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };
}

describe("skill authoring validation controller HTTP contract", function _DescribeHttpContract()
{
	it("accepts only a Job bind request for the namespace the server profile selected", function _ParsesBoundNamespace()
	{
		const command = { task: _Task(), binding: _Binding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "opencrane-skill-authoring" };

		expect(__ParseSkillAuthoringValidationWorkloadBindRequest(command, "opencrane-skill-authoring")).toEqual({ task: _Task(), command: { binding: _Binding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "opencrane-skill-authoring" } });
		expect(__ParseSkillAuthoringValidationWorkloadBindRequest({ ...command, namespace: "another-valid-namespace" }, "opencrane-skill-authoring")).toBeNull();
		expect(__ParseSkillAuthoringValidationWorkloadBindRequest({ ...command, unreviewedPolicy: "widen" }, "opencrane-skill-authoring")).toBeNull();
	});

	it("requires completion evidence to use the exact stored validation identity and digest", function _ParsesCompletion()
	{
		const completion = { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` };

		expect(__ParseSkillAuthoringValidationCompletionRequest({ task: _Task(), completion })).toEqual({ task: _Task(), completion });
		expect(__ParseSkillAuthoringValidationCompletionRequest({ task: _Task(), completion: { ...completion, completionDigest: "not-a-digest" } })).toBeNull();
	});
});
