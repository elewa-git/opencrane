import { describe, expect, it } from "vitest";

import { __AssertWarmRuntimeTiming } from "../warm-runtime-latency";

describe("warm runtime timing contract", function _WarmRuntimeTimingContract()
{
	it("accepts a sub-second claim and sub-five-second replacement", function _AcceptsBudgets()
	{
		expect(function _Assert(): void { __AssertWarmRuntimeTiming({ admittedAt: 10_000, readyAt: 10_999, poolMissObservedAt: 20_000, replacementReadyAt: 24_999 }); }).not.toThrow();
	});

	it("rejects the exact claim and replacement limits", function _RejectsLimits()
	{
		expect(function _Claim(): void { __AssertWarmRuntimeTiming({ admittedAt: 10_000, readyAt: 11_000 }); }).toThrow(/one-second/);
		expect(function _Replacement(): void { __AssertWarmRuntimeTiming({ admittedAt: 10_000, readyAt: 10_100, poolMissObservedAt: 20_000, replacementReadyAt: 25_000 }); }).toThrow(/five-second/);
	});
});
