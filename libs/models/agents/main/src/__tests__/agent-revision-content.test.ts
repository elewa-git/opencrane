import { describe, expect, it } from "vitest";

import { __DigestAgentRevisionContent } from "../agent-revision-content.js";
import type { AgentRevisionContent } from "../agent-revision.types.js";
import { ___DigestCanonicalJson } from "@opencrane/util";

/** Build one reviewed tool definition fixture. */
function _Tool(name: string)
{
	const parametersSchema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } } as const;
	return { name, description: `${name} description`, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

/** Build representative executable content for canonical digest coverage. */
function _Content(overrides: Partial<AgentRevisionContent> = {}): AgentRevisionContent
{
	return {
		promptPolicyVersion: "prompt-v1",
		personaRevisionId: "persona-1",
		modelDefinitionId: "model-1",
		budget: { maxTurns: 5, maxTokens: 1000, maxDurationMs: 30000 },
		skills: [{ skillId: "skill-1", revisionId: "skill-revision-1" }],
		integrationAssignments: [{
			integrationId: "integration-1",
			custodyReferenceId: "custody-1",
			toolDefinitions: [_Tool("calendar.read")],
		}],
		scopeAttachments: [{ scope: "personal", subjectType: "user", subjectId: "user-1" }],
		...overrides,
	};
}

describe("agent revision content digest", function _AgentRevisionContentDigestSuite()
{
	it("is stable for the same numbered executable content", function _StableDigest()
	{
		const first = __DigestAgentRevisionContent("service-1", 2, _Content());
		const second = __DigestAgentRevisionContent("service-1", 2, _Content());

		expect(second).toBe(first);
		expect(first).toBe("sha256:67c118d709d67426af63354b4d97b0c5ad2e82ea67ad7ae14a606f9bbc8371c2");
	});

	it.each([
		["prompt policy", { promptPolicyVersion: "prompt-v2" }],
		["persona", { personaRevisionId: "persona-2" }],
		["model", { modelDefinitionId: "model-2" }],
		["budget", { budget: { maxTurns: 6, maxTokens: 1000, maxDurationMs: 30000 } }],
		["skills", { skills: [{ skillId: "skill-2", revisionId: "skill-revision-2" }] }],
		["integrations", { integrationAssignments: [{ integrationId: "integration-2", custodyReferenceId: "custody-2", toolDefinitions: [_Tool("mail.read")] }] }],
		["scope attachments", { scopeAttachments: [{ scope: "team", subjectType: "group", subjectId: "team-1" }] }],
	] satisfies readonly (readonly [string, Partial<AgentRevisionContent>])[])("changes when %s change", function _ExecutableFieldChangesDigest(_field, overrides)
	{
		const original = __DigestAgentRevisionContent("service-1", 2, _Content());
		const changed = __DigestAgentRevisionContent("service-1", 2, _Content(overrides));

		expect(changed).not.toBe(original);
	});
});
