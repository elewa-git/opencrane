import { describe, expect, it } from "vitest";

import { ___ModelRoutingDefaultWriteSchema } from "../index";

describe("___ModelRoutingDefaultWriteSchema", function _Suite()
{
	it("reports nested Zod paths and preserves deliberate auto-config extensions", function _ValidateModelRoutingWrite()
	{
		const invalid = ___ModelRoutingDefaultWriteSchema.safeParse({ autoConfig: { objective: "unsupported", sessionPin: true, explorationRate: 2 } });
		expect(invalid.success).toBe(false);
		if (!invalid.success)
		{
			expect(invalid.error.issues.map(function _IssuePath(issue): (string | number)[] { return issue.path; })).toEqual([
				["autoConfig", "objective"],
				["autoConfig", "explorationRate"],
			]);
		}

		const valid = ___ModelRoutingDefaultWriteSchema.parse({
			autoConfig: { objective: "balanced", sessionPin: true, explorationRate: 0, futureKnob: "preserved" },
		});
		expect(valid.autoConfig).toMatchObject({ futureKnob: "preserved" });
	});

	it("accepts explicit null as the command to clear auto routing", function _AcceptClear()
	{
		const parsed = ___ModelRoutingDefaultWriteSchema.safeParse({ defaultModel: "openai/gpt", autoConfig: null });
		expect(parsed.success).toBe(true);
	});
});
