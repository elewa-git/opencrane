import { describe, expect, it } from "vitest";

import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";

import { _ParseAgentRevisionContent } from "../agent-revision-content.parser";

/** Builds administrator revision content around one MCP tool revision list. */
function _Content(mcpToolRevisionIds: unknown = ["mcp-tool-revision-1"])
{
	return { promptPolicyVersion: PROMPT_COMPILER_VERSION, personaRevisionId: null, modelDefinitionId: "model-1", budget: { maxTurns: 1, maxTokens: 100, maxCostUsdMicros: 500_000, maxDurationMs: 1_000 }, skills: [], boundaryAttachments: [], mcpToolRevisionIds };
}

describe("agent revision content parser", function _AgentRevisionContentParserSuite()
{
	it("accepts exact MCP tool revision identifiers", function _AcceptsReviewedContent()
	{
		expect(_ParseAgentRevisionContent(_Content())?.mcpToolRevisionIds).toEqual(["mcp-tool-revision-1"]);
	});

	it("rejects malformed MCP tool revision identifiers", function _RejectsMalformedMcpToolRevision()
	{
		expect(_ParseAgentRevisionContent(_Content([""]))).toBeNull();
		expect(_ParseAgentRevisionContent(_Content([null]))).toBeNull();
	});

	it("rejects a budget without a cost ceiling", function _RejectsMissingCostCeiling()
	{
		const content = _Content();
		delete (content.budget as Partial<typeof content.budget>).maxCostUsdMicros;

		expect(_ParseAgentRevisionContent(content)).toBeNull();
	});
});
