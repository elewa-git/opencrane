import { GrantAccess, GrantPayloadType, GrantScope, GrantSubjectType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaScopeGrantResolver } from "../prisma-scope-grant-resolver.js";

/** Builds the narrow Prisma read seam used by the effective knowledge-scope resolver. */
function _Prisma(grants: readonly unknown[])
{
	return { grant: { findMany: vi.fn().mockResolvedValue(grants) } };
}

describe("PrismaScopeGrantResolver", function _DescribePrismaScopeGrantResolver()
{
	it("keeps the highest-priority allow winner for each frozen scope target", async function _KeepsAllowWinner()
	{
		const prisma = _Prisma([
			{ id: "grant-1", payloadId: "project-1", scope: GrantScope.Project, access: GrantAccess.Allow, priority: 2, createdAt: new Date("2026-08-03T00:00:00.000Z") },
			{ id: "grant-2", payloadId: "team-1", scope: GrantScope.Team, access: GrantAccess.Allow, priority: 2, createdAt: new Date("2026-08-03T00:00:00.000Z") },
		]);

		await expect(new PrismaScopeGrantResolver(prisma as never).resolveEffectiveScopeGrants([{ subjectType: "service", subjectId: "agent-service:svc-1" }])).resolves.toEqual([
			{ scope: "project", subjectType: "group", subjectId: "project-1" },
			{ scope: "team", subjectType: "group", subjectId: "team-1" },
		]);
		expect(prisma.grant.findMany).toHaveBeenCalledWith({
			where: { payloadType: GrantPayloadType.KnowledgeScope, OR: [{ subjectType: GrantSubjectType.Service, subjectId: "agent-service:svc-1" }] },
			select: { id: true, payloadId: true, scope: true, access: true, priority: true, createdAt: true },
		});
	});

	it("lets an equal-priority deny block an allow for the same target", async function _DenyWins()
	{
		const prisma = _Prisma([
			{ id: "allow", payloadId: "project-1", scope: GrantScope.Project, access: GrantAccess.Allow, priority: 2, createdAt: new Date("2026-08-03T01:00:00.000Z") },
			{ id: "deny", payloadId: "project-1", scope: GrantScope.Project, access: GrantAccess.Deny, priority: 2, createdAt: new Date("2026-08-03T00:00:00.000Z") },
		]);

		await expect(new PrismaScopeGrantResolver(prisma as never).resolveEffectiveScopeGrants([{ subjectType: "service", subjectId: "agent-service:svc-1" }])).resolves.toEqual([]);
	});
});
