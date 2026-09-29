import { describe, expect, it } from "vitest";

import { AgentRunTriggers } from "../agent-run.types";

describe("AgentRunTriggers", () =>
{
	it("keeps one canonical serialized vocabulary for every root-run source", () =>
	{
		expect(Object.values(AgentRunTriggers)).toEqual(["interactive", "scheduled", "manual"]);
	});
});
