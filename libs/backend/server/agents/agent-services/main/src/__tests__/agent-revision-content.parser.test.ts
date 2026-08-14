import { describe, expect, it } from "vitest";

import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _ParseAgentRevisionContent } from "../agent-revision-content.parser";

/** Build reviewed administrator revision content around one tool-definition overlay. */
function _Content(toolOverrides: Record<string, unknown> = {})
{
	const parametersSchema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } } as const;
	return { promptPolicyVersion: PROMPT_COMPILER_VERSION, personaRevisionId: null, modelDefinitionId: "model-1", budget: { maxTurns: 1, maxTokens: 100, maxDurationMs: 1_000 }, skills: [], scopeAttachments: [], integrationAssignments: [{ integrationId: "search", custodyReferenceId: "custody-1", toolDefinitions: [{ name: "query", description: "Search records", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema), ...toolOverrides }] }] };
}

describe("agent revision content parser", function _AgentRevisionContentParserSuite()
{
	it("accepts the reviewed schema-bound administrator contract", function _AcceptsReviewedContent()
	{
		expect(_ParseAgentRevisionContent(_Content())?.integrationAssignments[0]?.toolDefinitions[0]?.name).toBe("query");
	});

	it("rejects a missing schema and a schema changed after its digest was reviewed", function _RejectsSchemaDrift()
	{
		expect(_ParseAgentRevisionContent(_Content({ parametersSchema: undefined }))).toBeNull();
		expect(_ParseAgentRevisionContent(_Content({ parametersSchema: { type: "object", additionalProperties: true } }))).toBeNull();
	});
});
