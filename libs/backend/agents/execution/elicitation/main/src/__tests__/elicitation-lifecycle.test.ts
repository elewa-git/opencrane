import { describe, expect, it } from "vitest";

import { ElicitationRequestStates } from "@opencrane/contracts";

import { __PlanElicitationLifecycle } from "../elicitation-lifecycle.js";
import { ElicitationLifecycleActions, ElicitationLifecycleEvents } from "../elicitation-lifecycle.types.js";

describe("elicitation lifecycle", function _DescribeElicitationLifecycle()
{
	it("allows every terminal event only from requested", function _AllowsRequestedTransitions()
	{
		for (const event of Object.values(ElicitationLifecycleEvents)) expect(__PlanElicitationLifecycle({ state: ElicitationRequestStates.Requested, event })).toBe(ElicitationLifecycleActions.Transition);
	});

	it("keeps every terminal state final for every event", function _KeepsTerminalStatesFinal()
	{
		for (const state of Object.values(ElicitationRequestStates).filter(function _Terminal(state): boolean { return state !== ElicitationRequestStates.Requested; }))
		{
			for (const event of Object.values(ElicitationLifecycleEvents)) expect(__PlanElicitationLifecycle({ state, event })).toBe(ElicitationLifecycleActions.AlreadyTerminal);
		}
	});
});
