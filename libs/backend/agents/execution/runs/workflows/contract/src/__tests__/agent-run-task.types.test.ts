import { describe, expect, it } from "vitest";

import { AgentRunTaskDeclaration, AgentRunTaskNames, AgentRunTaskTerminalStates } from "../index";

describe("AgentRun workflow task contract", function _DescribeAgentRunTaskContract()
{
	it("keeps the declaration bound to the planned controller task name", function _UsesAgentRunTaskName()
	{
		expect(AgentRunTaskDeclaration.taskName).toBe(AgentRunTaskNames.Execute);
	});

	it("lists only terminal states for the planned attempt lifecycle", function _UsesTerminalStates()
	{
		expect(Object.values(AgentRunTaskTerminalStates)).toEqual(["completed", "failed", "cancelled"]);
	});
});
