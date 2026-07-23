import { describe, expect, it } from "vitest";

import { __DecidePersonalConfigurationChange } from "../personal-configuration-decision.js";

/** Build one valid owner decision with optional test overrides. */
function _Command(overrides: Partial<Parameters<typeof __DecidePersonalConfigurationChange>[1]> = {})
{
	return { siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: "accepted" as const, rejectionReason: null, decidedAt: "2026-07-23T00:00:00.000Z", ...overrides };
}

describe("personal configuration decisions", function _DecisionSuite()
{
	it("records the owner's accepted decision without applying it", async function _Accepts()
	{
		const result = await __DecidePersonalConfigurationChange({ decideAtomically: async function _decide() { return { status: "accepted" } as const; } }, _Command());
		expect(result).toEqual({ outcome: "accepted" });
	});

	it("rejects a malformed rejection before persistence", async function _RejectsMalformed()
	{
		let called = false;
		const result = await __DecidePersonalConfigurationChange({ decideAtomically: async function _decide() { called = true; return { status: "rejected" } as const; } }, _Command({ decision: "rejected", rejectionReason: null }));
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(called).toBe(false);
	});
});
