import { describe, expect, it } from "vitest";

import { __DecideAgentThreadTarget } from "../agent-thread.js";

describe("Agent-thread target", function _AgentThreadTarget()
{
	it("accepts one exact bounded service coordinate", function _AcceptsExactTarget()
	{
		expect(__DecideAgentThreadTarget({ agentServiceId: "service-1" })).toEqual({ allowed: true });
	});

	it.each(["", " service-1", "service-1 ", "x".repeat(129)])("refuses a non-exact target", function _RefusesInvalidTarget(agentServiceId)
	{
		expect(__DecideAgentThreadTarget({ agentServiceId })).toEqual({ allowed: false });
	});
});
