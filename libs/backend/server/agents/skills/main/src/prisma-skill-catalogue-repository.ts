import { Prisma, SkillRevisionState, SkillState } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";

import { SkillCatalogueRevisionStates, SkillCatalogueStates, type SkillCatalogueEntry, type SkillCatalogueRepository } from "./skill-catalogue.types.js";

/** Maximum browser-safe skill summaries one silo can receive in one catalogue response. */
const _CATALOGUE_ENTRY_LIMIT = 200;

/**
 * Reads the skill catalogue from Postgres.
 *
 * The query selects only listing fields — id, name, description, states, timestamps — so no skill
 * bundle, manifest, signature, or review evidence can reach a browser even by accident. It reads
 * live rows with no cache, so a newly published revision shows up on the next request.
 *
 * Called by: `_CreateSkillCatalogueRouter` in `prisma-skill-catalogue.router.ts`.
 */
export class PrismaSkillCatalogueRepository implements SkillCatalogueRepository
{
	/** Canonical OpenCrane catalog database client. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the silo-scoped catalogue repository over the product database. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Lists at most 200 skills from this silo, most recently updated first and tie-broken by id so repeated calls agree. Wrapped in a trace span named `skills.catalogue.list`. */
	async listCatalogue(siloId: string): Promise<readonly SkillCatalogueEntry[]>
	{
		const self = this;
		return ___DoWithTrace("skills.catalogue.list", { siloId }, async function _ListCatalogue(): Promise<readonly SkillCatalogueEntry[]>
		{
			const skills = await self.prisma.skill.findMany({ where: { siloId }, select: { id: true, name: true, description: true, state: true, currentRevisionId: true, currentRevision: { select: { state: true } }, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: _CATALOGUE_ENTRY_LIMIT });
			return skills.map(function _MapSkill(skill): SkillCatalogueEntry
			{
				return {
					id: skill.id,
					name: skill.name,
					description: skill.description,
					state: skill.state === SkillState.Active ? SkillCatalogueStates.Active : SkillCatalogueStates.Retired,
					currentRevisionId: skill.currentRevisionId,
					currentRevisionState: skill.currentRevision === null ? null : _RevisionState(skill.currentRevision.state),
					createdAt: skill.createdAt.toISOString(),
					updatedAt: skill.updatedAt.toISOString(),
				};
			});
		});
	}
}

/** Converts a stored `SkillRevisionState` into the value returned over HTTP. The switch has no default arm, so adding a state to the Prisma schema without adding it here is a compile error rather than a runtime surprise. */
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
