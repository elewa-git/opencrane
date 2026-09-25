import { describe, expect, it } from "vitest";

import { __DigestAgentRevisionContent } from "../agent-revision-content";
import type { AgentBudget, AgentRevisionContent } from "../agent-revision.types";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds } from "../boundary-attachment.types";

/** Builds representative run limits for digest tests. */
function _Budget(overrides: Partial<AgentBudget> = {}): AgentBudget
{
	return { maxTurns: 5, maxTokens: 1000, maxCostUsdMicros: null, maxToolInvocations: 2, maxDurationMs: 30000, maxLoopIterations: 2, ...overrides };
}

/** Build representative executable content for canonical digest coverage. */
function _Content(overrides: Partial<AgentRevisionContent> = {}): AgentRevisionContent
{
	return {
		promptPolicyVersion: "prompt-v1",
		personaRevisionId: "persona-1",
		modelDefinitionId: "model-1",
		budget: _Budget(),
		skills: [{ skillId: "skill-1", revisionId: "skill-revision-1" }],
		mcpToolRevisionIds: ["mcp-tool-revision-1"],
		boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: "user-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }],
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
		expect(first).toBe("sha256:224e9d48a428960c2fefbe93897a4cb1e689575a8c051ee7a3b56c85402feaf9");
	});

	it.each([
		["prompt policy", { promptPolicyVersion: "prompt-v2" }],
		["persona", { personaRevisionId: "persona-2" }],
		["model", { modelDefinitionId: "model-2" }],
		["skills", { skills: [{ skillId: "skill-2", revisionId: "skill-revision-2" }] }],
		["MCP tools", { mcpToolRevisionIds: ["mcp-tool-revision-2"] }],
		["boundary attachments", { boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "team-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }] }],
	] satisfies readonly (readonly [string, Partial<AgentRevisionContent>])[])("changes when %s change", function _ExecutableFieldChangesDigest(_field, overrides)
	{
		const original = __DigestAgentRevisionContent("service-1", 2, _Content());
		const changed = __DigestAgentRevisionContent("service-1", 2, _Content(overrides));

		expect(changed).not.toBe(original);
	});

	it.each([
		["model calls", { maxTurns: 6 }],
		["tokens", { maxTokens: 1001 }],
		["cost", { maxCostUsdMicros: 500_000 }],
		["tool calls", { maxToolInvocations: 3 }],
		["elapsed time", { maxDurationMs: 30001 }],
		["loop iterations", { maxLoopIterations: 3 }],
	] satisfies readonly (readonly [string, Partial<AgentBudget>])[])("changes when the %s limit changes", function _BudgetFieldChangesDigest(_field, budget)
	{
		const original = __DigestAgentRevisionContent("service-1", 2, _Content());
		const changed = __DigestAgentRevisionContent("service-1", 2, _Content({ budget: _Budget(budget) }));

		expect(changed).not.toBe(original);
	});

	it("treats MCP tool revision ids as an unordered assignment set", function _StableMcpAssignmentOrder()
	{
		const first = __DigestAgentRevisionContent("service-1", 2, _Content({ mcpToolRevisionIds: ["mcp-tool-revision-2", "mcp-tool-revision-1"] }));
		const second = __DigestAgentRevisionContent("service-1", 2, _Content({ mcpToolRevisionIds: ["mcp-tool-revision-1", "mcp-tool-revision-2"] }));

		expect(second).toBe(first);
	});
});
