import { describe, expect, it } from "vitest";

import { __DiffAgentRevisions } from "../agent-revision-diff";
import type { AgentBudget, AgentRevision } from "../agent-revision.types";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds } from "../boundary-attachment.types";

/** Builds complete revision limits for field-level widening checks. */
function _Budget(overrides: Partial<AgentBudget> = {}): AgentBudget
{
	return { maxTurns: 5, maxTokens: 1000, maxCostUsdMicros: null, maxToolInvocations: 2, maxDurationMs: 30000, maxLoopIterations: 2, ...overrides };
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
		mcpToolRevisionIds: ["mcp-tool-revision-a"],
		boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "proj-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }],
		budget: _Budget(),
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

	it("flags scope, tool, and budget widening", function _widening()
	{
		const target = _revision({
			boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "proj-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }, { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "org-1", boundaryCoverage: RevisionBoundaryCoverages.Descendants }],
			skills: [{ skillId: "skill-a", revisionId: "rev-1" }, { skillId: "skill-b", revisionId: "rev-1" }],
			budget: { maxTurns: 20, maxTokens: 1000, maxCostUsdMicros: null, maxToolInvocations: 2, maxDurationMs: 30000, maxLoopIterations: 2 },
		});
		const diff = __DiffAgentRevisions(_revision(), target);
		const kinds = diff.widenings.map(function _kind(widening) { return widening.kind; });
		expect(kinds).toContain("boundary");
		expect(kinds).toContain("tools");
		expect(kinds).toContain("budget");
	});

	it("does not flag budget widening when a ceiling is lowered", function _narrower()
	{
		const diff = __DiffAgentRevisions(_revision(), _revision({ budget: _Budget({ maxTurns: 2 }) }));
		expect(diff.widenings).toEqual([]);
		expect(diff.scalarChanges).toContainEqual({ field: "budget.maxTurns", before: "5", after: "2" });
	});

	it.each([
		["budget.maxToolInvocations", _Budget({ maxToolInvocations: 3 })],
		["budget.maxLoopIterations", _Budget({ maxLoopIterations: 3 })],
		["budget.maxCostUsdMicros", _Budget({ maxCostUsdMicros: 750_000 })],
	])("reports a wider %s ceiling", function _WiderLimit(field, budget)
	{
		const baseBudget = field === "budget.maxCostUsdMicros" ? _Budget({ maxCostUsdMicros: 500_000 }) : _Budget();
		const diff = __DiffAgentRevisions(_revision({ budget: baseBudget }), _revision({ budget }));

		expect(diff.widenings).toContainEqual(expect.objectContaining({ kind: "budget", field }));
		expect(diff.scalarChanges).toContainEqual(expect.objectContaining({ field }));
	});

	it("treats removal of a revision cost cap as widening and adding one as narrowing", function _NullableCost()
	{
		const capped = _revision({ budget: _Budget({ maxCostUsdMicros: 500_000 }) });
		const uncapped = _revision();

		expect(__DiffAgentRevisions(capped, uncapped).widenings).toContainEqual(expect.objectContaining({ kind: "budget", field: "budget.maxCostUsdMicros" }));
		expect(__DiffAgentRevisions(uncapped, capped).widenings).toEqual([]);
	});
});
