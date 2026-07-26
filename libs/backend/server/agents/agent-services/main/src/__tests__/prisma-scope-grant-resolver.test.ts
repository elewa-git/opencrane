import { GrantAccess, GrantPayloadType, GrantScope, GrantSubjectType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaScopeGrantResolver } from "../prisma-scope-grant-resolver.js";

describe("PrismaScopeGrantResolver", function ()
{
	it("projects the knowledge payload target instead of the receiving principal", async function ()
	{
		const prisma = {
			group: { findMany: vi.fn().mockResolvedValue([]) },
			grant: {
				findMany: vi.fn().mockResolvedValue([{
					id: "grant-1",
					payloadType: GrantPayloadType.Awareness,
					payloadId: "project-1",
					access: GrantAccess.Allow,
					priority: 10,
					scope: GrantScope.Project,
					subjectType: GrantSubjectType.Tenant,
					subjectId: "agent-service:service-1",
					createdAt: new Date("2026-07-26T00:00:00.000Z"),
				}]),
			},
		};
		const resolver = new PrismaScopeGrantResolver(prisma as never);

		await expect(resolver.resolveEffectiveScopeGrants(["agent-service:service-1"])).resolves.toEqual([
			{ scope: "project", subjectType: "group", subjectId: "project-1" },
		]);
	});
});
