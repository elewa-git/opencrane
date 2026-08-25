import { describe, expect, it } from "vitest";

import { ArtifactPreprocessTaskDeclaration, ArtifactPreprocessTaskNames } from "../index";

describe("artifact preprocess task contract", function _DescribeArtifactPreprocessTaskContract()
{
	it("keeps the declaration bound to the supported PDF task name", function _UsesPdfTaskName()
	{
		expect(ArtifactPreprocessTaskDeclaration.taskName).toBe(ArtifactPreprocessTaskNames.Convert);
	});
});
