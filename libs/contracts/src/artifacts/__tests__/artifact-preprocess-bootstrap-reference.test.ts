import { describe, expect, it } from "vitest";

import { __CreateArtifactPreprocessBootstrapReference, __HashArtifactPreprocessBootstrapReference, __IsArtifactPreprocessBootstrapReference } from "../artifact-preprocess-bootstrap-reference";

describe("artifact preprocessing bootstrap reference contract", function _DescribeArtifactPreprocessBootstrapReference()
{
	it("derives and validates an opaque reference without exposing the preprocessing job ID", async function _DerivesReference()
	{
		const reference = await __CreateArtifactPreprocessBootstrapReference("preprocess_job-1");

		expect(reference).toMatch(/^artifact-preprocess-bootstrap-v1_[a-f0-9]{64}$/);
		expect(reference).not.toContain("preprocess_job-1");
		expect(__IsArtifactPreprocessBootstrapReference(reference)).toBe(true);
		expect(await __HashArtifactPreprocessBootstrapReference(reference)).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("rejects malformed job IDs and reference values", async function _RejectsMalformedValues()
	{
		await expect(__CreateArtifactPreprocessBootstrapReference("contains space")).rejects.toThrow(/not safe/);
		expect(__IsArtifactPreprocessBootstrapReference("artifact-preprocess-bootstrap-v1_short")).toBe(false);
	});
});
