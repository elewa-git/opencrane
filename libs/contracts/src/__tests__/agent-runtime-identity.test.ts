import { describe, expect, it } from "vitest";

import { ___IsAgentRuntimeServiceAccountName } from "../index.js";

describe("agent runtime identity contract", function ()
{
	it("accepts only the bounded runtime ServiceAccount class", function ()
	{
		expect(___IsAgentRuntimeServiceAccountName("agent-runtime-default")).toBe(true);
		expect(___IsAgentRuntimeServiceAccountName("agent-runtime-gpu-a10")).toBe(true);
		expect(___IsAgentRuntimeServiceAccountName("personal-agent-runtime")).toBe(false);
		expect(___IsAgentRuntimeServiceAccountName("agent-runtime-")).toBe(false);
		expect(___IsAgentRuntimeServiceAccountName(`agent-runtime-${"a".repeat(50)}`)).toBe(false);
	});
});
