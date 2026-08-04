import { Prisma, SkillRevisionState, SkillState } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/observability";

import { SkillCatalogueRevisionStates, SkillCatalogueStates } from "./skill-catalogue.types.js";
import type { SkillCatalogueEntry, SkillCatalogueRepository } from "./skill-catalogue.types.js";

/** Maximum browser-safe skill summaries one silo can receive in one catalogue response. */
const _CATALOGUE_ENTRY_LIMIT = 200;

/** Prisma repository for the live, browser-safe governed skill catalogue. */
export class PrismaSkillCatalogueRepository implements SkillCatalogueRepository
{
	/** Canonical OpenCrane catalog database client. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the silo-scoped catalogue repository over the product database. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Lists bounded browser-safe metadata for the exact host-derived silo. */
	async listCatalogue(siloId: string): Promise<readonly SkillCatalogueEntry[]>
	{
		const self = this;
		return ___DoWithTrace("skills.catalogue.list", { siloId }, async function _ListCatalogue(): Promise<readonly SkillCatalogueEntry[]>
		{
			const skills = await self.prisma.skill.findMany({ where: { siloId }, select: { id: true, name: true, description: true, state: true, currentRevisionId: true, currentRevision: { select: { state: true } }, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: _CATALOGUE_ENTRY_LIMIT });
			return skills.map(function _MapSkill(skill): SkillCatalogueEntry
			{
				return { id: skill.id, name: skill.name, description: skill.description, state: skill.state === SkillState.Active ? SkillCatalogueStates.Active : SkillCatalogueStates.Retired, currentRevisionId: skill.currentRevisionId, currentRevisionState: skill.currentRevision === null ? null : _RevisionState(skill.currentRevision.state), createdAt: skill.createdAt.toISOString(), updatedAt: skill.updatedAt.toISOString() };
			});
		});
	}
}

/** Converts generated persistence lifecycle values into the browser catalogue vocabulary. */
function _RevisionState(state: SkillRevisionState): SkillCatalogueRevisionStates
{
	switch (state)
	{
		case SkillRevisionState.Draft: return SkillCatalogueRevisionStates.Draft;
		case SkillRevisionState.Review: return SkillCatalogueRevisionStates.Review;
		case SkillRevisionState.Published: return SkillCatalogueRevisionStates.Published;
		case SkillRevisionState.Rejected: return SkillCatalogueRevisionStates.Rejected;
		case SkillRevisionState.Revoked: return SkillCatalogueRevisionStates.Revoked;
	}
}
