import { describe, expect, it } from "vitest";

import { __CreateSkillWorkloadBootstrapReference, __HashSkillWorkloadBootstrapReference, __IsSkillWorkloadBootstrapReference } from "../skill-workload-bootstrap-reference.js";

describe("governed skill bootstrap reference contract", function _DescribeSkillBootstrapReference()
{
	it("derives and validates one deterministic opaque reference without leaking the durable workload id", async function _DerivesReference()
	{
		const reference = await __CreateSkillWorkloadBootstrapReference("workload_1");

		expect(reference).toMatch(/^skill-bootstrap-v1_[a-f0-9]{64}$/);
		expect(reference).not.toContain("workload_1");
		expect(__IsSkillWorkloadBootstrapReference(reference)).toBe(true);
		expect(await __HashSkillWorkloadBootstrapReference(reference)).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("rejects malformed workload identifiers and wire values", async function _RejectsMalformedValues()
	{
		await expect(__CreateSkillWorkloadBootstrapReference("contains space")).rejects.toThrow(/not safe/);
		expect(__IsSkillWorkloadBootstrapReference("skill-bootstrap-v1_short")).toBe(false);
	});
});
