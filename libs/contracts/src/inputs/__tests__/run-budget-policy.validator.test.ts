import { describe, expect, it } from "vitest";

import { ___ParseRunBudgetPolicy } from "../run-budget-policy.validator";
import type { RunBudgetPolicy } from "../run-budget-policy.types";

/** Supplies a complete saved allowance, independent of any product default. */
function _budget(): RunBudgetPolicy
{
	return { maxModelTurns: 4, maxCompletionTokens: 2048, maxCostUsdMicros: 50_000, maxToolInvocations: 2, maxLoopIterations: 2, wallClockDeadlineEpochMs: 2_000_000_000_000 };
}

describe("saved run budget", function ()
{
	it("keeps the original values and copies the input", function ()
	{
		const input = _budget();
		const result = ___ParseRunBudgetPolicy(input);
		expect(result).toEqual(input);
		expect(result).not.toBe(input);
	});

	it("accepts an explicit text-only allowance and no additional revision spend cap", function ()
	{
		const input = { ..._budget(), maxToolInvocations: 0, maxCostUsdMicros: null };
		expect(___ParseRunBudgetPolicy(input)).toEqual(input);
	});

	it("preserves an expired deadline for historical recovery without renewing it", function ()
	{
		expect(___ParseRunBudgetPolicy({ ..._budget(), wallClockDeadlineEpochMs: 1 }).wallClockDeadlineEpochMs).toBe(1);
	});

	it.each(Object.keys(_budget()))("requires the saved %s field", function (field)
	{
		const input: Record<string, unknown> = { ..._budget() };
		delete input[field];
		expect(function () { ___ParseRunBudgetPolicy(input); }).toThrow();
	});

	it.each(Object.keys(_budget()))("rejects malformed %s instead of making it uncapped", function (field)
	{
		for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "4"])
			expect(function () { ___ParseRunBudgetPolicy({ ..._budget(), [field]: value }); }).toThrow();
		if (field !== "maxCostUsdMicros")
			expect(function () { ___ParseRunBudgetPolicy({ ..._budget(), [field]: null }); }).toThrow();
		if (field !== "maxToolInvocations")
			expect(function () { ___ParseRunBudgetPolicy({ ..._budget(), [field]: 0 }); }).toThrow();
	});

	it("rejects unknown limits and deadlines outside the Date range", function ()
	{
		expect(function () { ___ParseRunBudgetPolicy({ ..._budget(), extraAllowance: 100 }); }).toThrow();
		expect(function () { ___ParseRunBudgetPolicy({ ..._budget(), wallClockDeadlineEpochMs: 8_640_000_000_000_001 }); }).toThrow();
	});
});
