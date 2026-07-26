import { describe, expect, it, vi } from "vitest";

import { PrismaSkillRevisionEligibilitySource } from "../prisma-skill-revision-eligibility-source.js";

/** Builds one final-admission transaction fake containing a locked assignment query result. */
function _Transaction(rows: readonly unknown[])
{
	return { prisma: { $queryRaw: vi.fn().mockResolvedValue(rows) }, admittedAt: "2026-07-23T12:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-23T12:00:00.000Z") } as never;
}

/** Builds the immutable tool-policy skill coordinates proposed for one future run. */
function _ToolPolicy(skillRevisionIds: readonly string[])
{
	return { modelRoute: {}, toolGrantIds: [], skillRevisionIds, artifactRevisionIds: [] };
}

describe("PrismaSkillRevisionEligibilitySource", function _describeEligibility()
{
	it("accepts the complete same-silo published assignment set while it is locked", async function _accepts()
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
