import { describe, expect, it } from "vitest";

import { __ParseAgentBudget } from "../agent-budget.validator";
import type { AgentBudget } from "../agent-revision.types";

/** Builds the complete stored policy while letting one test replace a field. */
function _Budget(overrides: Partial<AgentBudget> = {}): AgentBudget
{
	return {
		maxTurns: 5,
		maxTokens: 10_000,
		maxCostUsdMicros: null,
		maxToolInvocations: 0,
		maxDurationMs: 60_000,
		maxLoopIterations: 2,
		...overrides,
	};
}

describe("agent budget validation", function _Suite()
{
	it("copies the exact policy and accepts an explicit text-only tool allowance", function _Parses()
	{
		const source = _Budget();
		const parsed = __ParseAgentBudget(source);

		expect(parsed).toEqual(source);
		expect(parsed).not.toBe(source);
		expect(Object.isFrozen(parsed)).toBe(true);
	});

	it.each([
		null,
		[],
		{},
		{ ..._Budget(), extra: 1 },
		{ ..._Budget(), maxTurns: 0 },
		{ ..._Budget(), maxTokens: 1.5 },
		{ ..._Budget(), maxCostUsdMicros: 0 },
		{ ..._Budget(), maxCostUsdMicros: Number.MAX_SAFE_INTEGER + 1 },
		{ ..._Budget(), maxToolInvocations: -1 },
		{ ..._Budget(), maxDurationMs: Number.NaN },
		{ ..._Budget(), maxLoopIterations: 0 },
	])("rejects malformed or incomplete stored policy %j", function _Rejects(value)
	{
		expect(function _Parse() { __ParseAgentBudget(value); }).toThrow("Agent budget");
	});

	it("accepts a positive revision cost without changing its value", function _CostCap()
	{
		expect(__ParseAgentBudget(_Budget({ maxCostUsdMicros: 750_000 })).maxCostUsdMicros).toBe(750_000);
	});
});
