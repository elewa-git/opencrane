import type { PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { PrismaSkillCatalogueRepository } from "./prisma-skill-catalogue-repository";
import type { SkillCatalogueEntry, SkillCatalogueRepository } from "./skill-catalogue.types";

/** Opens the database transaction shared by skill discovery and its central authorization read. */
export class PrismaSkillCatalogueUnitOfWork implements SkillCatalogueRepository
{
	/** Root client that opens one short catalogue transaction. */
	private readonly prisma: PrismaClient;

	/** Binds the product database used for skill discovery. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async listCatalogue(siloId: string, principalId: string): Promise<readonly SkillCatalogueEntry[]>
	{
		return this.prisma.$transaction(async function _List(transaction): Promise<readonly SkillCatalogueEntry[]>
		{
			const authorization = new PrismaAuthorizationAuthority(transaction);
			const catalogue = new PrismaSkillCatalogueRepository(transaction, authorization);
			return catalogue.listCatalogue(siloId, principalId);
		});
	}
}
