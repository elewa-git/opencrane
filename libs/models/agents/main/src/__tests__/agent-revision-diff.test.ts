import { describe, expect, it } from "vitest";

import { __DiffAgentRevisions } from "../agent-revision-diff";
import type { AgentRevision } from "../agent-revision.types";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds } from "../boundary-attachment.types";
import { ___DigestCanonicalJson } from "@opencrane/util";

/** Build one reviewed tool definition fixture. */
function _Tool(name: string)
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { name, description: `${name} description`, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

/** Builds a baseline immutable revision fixture. */
function _revision(overrides: Partial<AgentRevision> = {}): AgentRevision
{
	return {
		id: "revision-1",
		agentServiceId: "service-1",
		revision: 1,
		parentRevisionId: null,
		sourceRevisionId: null,
		changeMessage: "initial",
		state: "draft",
		digest: "sha256:base",
		promptPolicyVersion: "line-one\nline-two",
		personaRevisionId: null,
	modelDefinitionId: "model-definition-a",
		skills: [{ skillId: "skill-a", revisionId: "rev-1" }],
		integrationAssignments: [{ integrationId: "int-a", custodyReferenceId: "cust-1", toolDefinitions: [_Tool("read")] }],
		mcpToolRevisionIds: ["mcp-tool-revision-a"],
		boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "proj-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }],
		budget: { maxTurns: 5, maxTokens: 1000, maxDurationMs: 30000 },
		authoredBy: "user-1",
		createdAt: "2026-07-20T00:00:00.000Z",
		publishedAt: null,
		...overrides,
	};
}

describe("agent revision diff", function _suite()
{
	it("returns an empty diff for identical revisions", function _identical()
	{
		const diff = __DiffAgentRevisions(_revision(), _revision({ id: "revision-2" }));
		expect(diff).toEqual({ lineDiffs: [], scalarChanges: [], setChanges: [], widenings: [] });
	});

	it("computes line-level prompt diffs", function _prompt()
	{
		const diff = __DiffAgentRevisions(_revision(), _revision({ promptPolicyVersion: "line-one\nline-three" }));
		expect(diff.lineDiffs).toEqual([{ field: "promptPolicyVersion", addedLines: ["line-three"], removedLines: ["line-two"] }]);
	});

	it("flags scope, tool, credential, and budget widening", function _widening()
	{
		const target = _revision({
			boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "proj-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }, { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "org-1", boundaryCoverage: RevisionBoundaryCoverages.Descendants }],
			skills: [{ skillId: "skill-a", revisionId: "rev-1" }, { skillId: "skill-b", revisionId: "rev-1" }],
			integrationAssignments: [
				{ integrationId: "int-a", custodyReferenceId: "cust-1", toolDefinitions: [_Tool("read"), _Tool("write")] },
				{ integrationId: "int-b", custodyReferenceId: "cust-2", toolDefinitions: [_Tool("send")] },
			],
			budget: { maxTurns: 20, maxTokens: 1000, maxDurationMs: 30000 },
		});
		const diff = __DiffAgentRevisions(_revision(), target);
		const kinds = diff.widenings.map(function _kind(widening) { return widening.kind; });
		expect(kinds).toContain("boundary");
		expect(kinds).toContain("tools");
		expect(kinds).toContain("credentials");
		expect(kinds).toContain("budget");
	});

	it("does not flag budget widening when a ceiling is lowered", function _narrower()
	{
		const diff = __DiffAgentRevisions(_revision(), _revision({ budget: { maxTurns: 2, maxTokens: 1000, maxDurationMs: 30000 } }));
		expect(diff.widenings).toEqual([]);
		expect(diff.scalarChanges).toContainEqual({ field: "budget.maxTurns", before: "5", after: "2" });
	});
});
