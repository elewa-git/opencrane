import { describe, expect, it } from "vitest";

import { ___ParseAndValidateJson } from "../json.js";

/** Validate one object field while proving the generic return type. */
function _Count(candidate: unknown, minimum: number): number
{
	if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) || !("count" in candidate) || typeof candidate.count !== "number" || candidate.count < minimum)
	{
		throw new Error("count is below its required minimum");
	}
	return candidate.count;
}

describe("JSON boundary utility", function _Suite()
{
	it("parses unknown JSON and returns the validator-owned generic type", function _ParsesAndValidates()
	{
		const count: number = ___ParseAndValidateJson("{\"count\":3}", "COUNT_JSON", _Count, 2);

		expect(count).toBe(3);
	});

	it("labels syntax failures without swallowing domain validation failures", function _SeparatesFailures()
	{
		expect(function _InvalidJson() { ___ParseAndValidateJson("{", "COUNT_JSON", _Count, 2); }).toThrow(/COUNT_JSON must contain valid JSON/);
		expect(function _InvalidCount() { ___ParseAndValidateJson("{\"count\":1}", "COUNT_JSON", _Count, 2); }).toThrow(/count is below its required minimum/);
	});
});
