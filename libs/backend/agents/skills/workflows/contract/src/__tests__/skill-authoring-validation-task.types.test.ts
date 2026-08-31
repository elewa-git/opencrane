import { describe, expect, it } from "vitest";

import { SkillAuthoringValidationTaskDeclaration, SkillAuthoringValidationTaskNames } from "../index";

describe("skill authoring validation task contract", function _DescribeSkillAuthoringValidationTaskContract()
{
	it("keeps the declaration bound to the one supported remote task name", function _UsesValidationTaskName()
	{
		expect(SkillAuthoringValidationTaskDeclaration.taskName).toBe(SkillAuthoringValidationTaskNames.Validate);
	});
});
