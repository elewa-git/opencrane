import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAuthorizationGrantRepository } from "../prisma-authorization-grants.js";

describe("Prisma authorization grant reader", function _suite()
{
	it("maps project grants as an independent scope dimension", async function _project()
	{
		const findMany = vi.fn().mockResolvedValue([{
			id: "grant-1",
			siloId: "silo-1",
			subjectId: "user-1",
			scopeKind: "Project",
			organizationId: "org-1",
			scopeResourceId: "project-1",
			catalogId: "catalog-1",
			catalogRevision: 1,
			catalogDigest: `sha256:${"1".repeat(64)}`,
			capabilityId: "artifact.read",
			resourceKind: "artifact",
			resourceId: "artifact-1",
			effect: "Allow",
			priority: 10,
			validFrom: new Date("2026-07-18T00:00:00.000Z"),
			expiresAt: null,
			revokedAt: null,
		}]);
		const repository = new PrismaAuthorizationGrantRepository({ authorizationGrant: { findMany } } as unknown as PrismaClient);

		const grants = await repository.listSubjectGrants("silo-1", "user-1");

		expect(grants[0]?.scope).toEqual({ kind: "project", organizationId: "org-1", projectId: "project-1" });
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", subjectId: "user-1" }, orderBy: [{ priority: "desc" }, { id: "asc" }] });
	});
});
