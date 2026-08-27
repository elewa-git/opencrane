import { describe, expect, it, vi } from "vitest";

import { PrismaSkillRevisionEligibilitySource } from "../prisma-skill-revision-eligibility-source";

/** Assignment and current revision facts exposed by the fake transaction. */
interface _SkillRow
{
	readonly skillRevisionId: string;
	readonly isPublished: boolean;
	readonly revokedAt: Date | null;
	readonly siloId: string;
}

/** Builds a fake admission transaction that returns fixed assignment and revision rows. */
function _Transaction(rows: readonly _SkillRow[])
{
	return {
		prisma: {
			agentRevisionSkillAssignment: { findMany: vi.fn().mockResolvedValue(rows.map(function _Assignment(row) { return { skillRevisionId: row.skillRevisionId }; })) },
			skillRevision: { findMany: vi.fn().mockResolvedValue(rows.map(function _Revision(row) { return { id: row.skillRevisionId, state: row.isPublished ? "Published" : "Revoked", revokedAt: row.revokedAt, skill: { siloId: row.siloId } }; })) },
		},
		admittedAt: "2026-07-23T12:00:00.000Z",
		admittedAtEpochMs: Date.parse("2026-07-23T12:00:00.000Z"),
	} as never;
}

/** Builds the skill ids a tool policy would name for one run. */
function _ToolPolicy(skillRevisionIds: readonly string[])
{
	return { modelRoute: {}, mcpTools: [], skillRevisionIds, artifactRevisionIds: [] };
}

describe("PrismaSkillRevisionEligibilitySource", function _describeEligibility()
{
	it("accepts the complete same-silo published assignment set", async function _accepts()
	{
		const result = await new PrismaSkillRevisionEligibilitySource().load({ siloId: "silo-1" } as never, { agentRevisionId: "agent-revision-1" } as never, _ToolPolicy(["revision-1"]), _Transaction([{ skillRevisionId: "revision-1", isPublished: true, revokedAt: null, siloId: "silo-1" }]));
		expect(result).toEqual({ outcome: "loaded", value: null });
	});

	it("denies a revoked assigned revision before any snapshot can be persisted", async function _deniesRevoked()
	{
		const result = await new PrismaSkillRevisionEligibilitySource().load({ siloId: "silo-1" } as never, { agentRevisionId: "agent-revision-1" } as never, _ToolPolicy(["revision-1"]), _Transaction([{ skillRevisionId: "revision-1", isPublished: false, revokedAt: new Date("2026-07-23T12:00:00.000Z"), siloId: "silo-1" }]));
		expect(result).toEqual({ outcome: "denied", reason: "skill_unavailable" });
	});

	it("permits the safe subset that remains after effective-grant intersection", async function _permitsSubset()
	{
		const result = await new PrismaSkillRevisionEligibilitySource().load({ siloId: "silo-1" } as never, { agentRevisionId: "agent-revision-1" } as never, _ToolPolicy([]), _Transaction([{ skillRevisionId: "revision-1", isPublished: true, revokedAt: null, siloId: "silo-1" }]));
		expect(result).toEqual({ outcome: "loaded", value: null });
	});

	it("denies an invented skill revision that is not assigned to this AgentRevision", async function _deniesInventedRevision()
	{
		const result = await new PrismaSkillRevisionEligibilitySource().load({ siloId: "silo-1" } as never, { agentRevisionId: "agent-revision-1" } as never, _ToolPolicy(["revision-other"]), _Transaction([{ skillRevisionId: "revision-1", isPublished: true, revokedAt: null, siloId: "silo-1" }]));
		expect(result).toEqual({ outcome: "denied", reason: "skill_unavailable" });
	});
});
