import { z } from "zod";
import { describe, expect, it } from "vitest";

import { ___IsAgentControllerIdentifier, ___IsEmptyAgentControllerCommand, _AgentControllerBoundedIdentifierSchema, _AgentControllerMillisecondInstantSchema, _ParseAgentControllerCommand, _ParseAgentControllerModel } from "../agent-controller-wire.validator";

describe("agent-controller wire grammar", function _DescribeWireGrammar()
{
	it("bounds identifiers and rejects control characters", function _BoundsIdentifiers()
	{
		expect(___IsAgentControllerIdentifier("run-1")).toBe(true);
		expect(___IsAgentControllerIdentifier("")).toBe(false);
		expect(___IsAgentControllerIdentifier("run\n1")).toBe(false);
	});

	it("requires canonical millisecond instants", function _RequiresCanonicalInstants()
	{
		expect(_AgentControllerMillisecondInstantSchema.safeParse("2026-07-20T00:00:00.000Z").success).toBe(true);
		expect(_AgentControllerMillisecondInstantSchema.safeParse("2026-07-20T00:00:00Z").success).toBe(false);
	});

	it("accepts only a strict empty server-owned command", function _RequiresEmptyCommand()
	{
		expect(___IsEmptyAgentControllerCommand({})).toBe(true);
		expect(___IsEmptyAgentControllerCommand({ policy: "caller-selected" })).toBe(false);
	});

	it("keeps null command rejection and stable diagnostic paths", function _KeepsParsingSemantics()
	{
		const command = z.object({ runId: _AgentControllerBoundedIdentifierSchema }).strict();
		expect(_ParseAgentControllerCommand(command, null)).toBeNull();
		expect(function _ParseInvalidModel() { _ParseAgentControllerModel(command, { runId: "" }, "controller command"); }).toThrow("controller command.runId must be a bounded identifier");
	});
});
