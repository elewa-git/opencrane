import { describe, expect, it } from "vitest";

import { __CreateSkillAuthoringValidationBootstrapReference, __HashSkillAuthoringValidationBootstrapReference, __IsSkillAuthoringValidationBootstrapReference } from "../skill-authoring-validation-bootstrap-reference";

describe("governed skill bootstrap reference contract", function _DescribeSkillBootstrapReference()
{
	it("derives and validates one deterministic opaque reference without leaking the validation id", async function _DerivesReference()
	{
		const reference = await __CreateSkillAuthoringValidationBootstrapReference("validation_1");

		expect(reference).toMatch(/^skill-bootstrap-v1_[a-f0-9]{64}$/);
		expect(reference).not.toContain("validation_1");
		expect(__IsSkillAuthoringValidationBootstrapReference(reference)).toBe(true);
		expect(await __HashSkillAuthoringValidationBootstrapReference(reference)).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("rejects malformed validation identifiers and wire values", async function _RejectsMalformedValues()
	{
		await expect(__CreateSkillAuthoringValidationBootstrapReference("contains space")).rejects.toThrow(/not safe/);
		expect(__IsSkillAuthoringValidationBootstrapReference("skill-bootstrap-v1_short")).toBe(false);
	});
});
