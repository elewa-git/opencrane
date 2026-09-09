import { SkillRevisionState, SkillState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaSkillCatalogueRepository } from "../prisma-skill-catalogue-repository";
import { SkillCatalogueRevisionStates, SkillCatalogueStates } from "../skill-catalogue.types";

/** Builds one persisted row containing only browser-safe catalogue fields. */
function _skillRow()
{
	return { id: "skill-1", name: "Research", description: "Summarises trusted sources.", state: SkillState.Active, currentRevisionId: "revision-1", currentRevision: { state: SkillRevisionState.Published }, createdAt: new Date("2026-07-26T12:00:00.000Z"), updatedAt: new Date("2026-07-26T13:00:00.000Z") };
}

describe("Prisma skill catalogue repository", function _suite()
{
	it("reads only the host-derived silo in a bounded deterministic order", async function _listsSiloCatalogue()
	{
		const findMany = vi.fn().mockResolvedValue([_skillRow()]);
		const prisma = { skill: { findMany } } as unknown as Prisma.TransactionClient;
		const authorization = { listPrincipalEntitled: vi.fn().mockResolvedValue([{ kind: ProductAuthorizationResourceKinds.Skill, id: "skill-1" }]) };

		await expect(new PrismaSkillCatalogueRepository(prisma, authorization as never).listCatalogue("silo-1", "principal-1")).resolves.toEqual([{ id: "skill-1", name: "Research", description: "Summarises trusted sources.", state: SkillCatalogueStates.Active, currentRevisionId: "revision-1", currentRevisionState: SkillCatalogueRevisionStates.Published, createdAt: "2026-07-26T12:00:00.000Z", updatedAt: "2026-07-26T13:00:00.000Z" }]);
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1" }, select: { id: true, name: true, description: true, state: true, currentRevisionId: true, currentRevision: { select: { state: true } }, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 200 });
		expect(authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", action: ProductAuthorizationActions.Discover, resources: [{ kind: ProductAuthorizationResourceKinds.Skill, id: "skill-1" }] }));
	});

	it("omits lifecycle candidates denied by the central authority", async function _FiltersDeniedSkills()
	{
		const prisma = { skill: { findMany: vi.fn().mockResolvedValue([_skillRow()]) } } as unknown as Prisma.TransactionClient;
		const authorization = { listPrincipalEntitled: vi.fn().mockResolvedValue([]) };

		await expect(new PrismaSkillCatalogueRepository(prisma, authorization as never).listCatalogue("silo-1", "principal-1")).resolves.toEqual([]);
	});
});
