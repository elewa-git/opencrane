import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { PersonalArtifactCatalogueRepository, PersonalArtifactEntry } from "./artifact-finalization.types";
import { PrismaArtifactCatalogueRepository } from "./prisma-artifact-catalogue-repository";

/** Maximum authorized artifacts returned by the personal catalogue route. */
const _CATALOGUE_LIMIT = 50;

/** Lists artifact metadata and central Discover entitlements from one repeatable snapshot. */
export class PrismaPersonalArtifactCatalogueUnitOfWork implements PersonalArtifactCatalogueRepository
{
	private readonly prisma: PrismaClient;

	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async listCatalogue(siloId: string, principalId: string): Promise<readonly PersonalArtifactEntry[]>
	{
		return this.prisma.$transaction(async function _List(transaction)
		{
			const catalogue = new PrismaArtifactCatalogueRepository(transaction);
			const authorization = new PrismaAuthorizationAuthority(transaction);
			const authorized: PersonalArtifactEntry[] = [];
			const nowEpochMs = Date.now();
			let cursor: Awaited<ReturnType<typeof catalogue.listCatalogueCandidates>>["nextCursor"] = null;
			do
			{
				// 1. Read one bounded raw page so unrelated newer artifacts cannot starve an entitlement.
				const page = await catalogue.listCatalogueCandidates(siloId, cursor, _CATALOGUE_LIMIT);

				// 2. Evaluate the page across current personal and direct Group boundaries in this snapshot.
				const entitled = await authorization.listPrincipalEntitled({ siloId, principalId, action: ProductAuthorizationActions.Discover, resources: page.entries.map(artifact => ({ kind: ProductAuthorizationResourceKinds.Artifact, id: artifact.id })), nowEpochMs });
				const ids = new Set(entitled.map(resource => resource.id));
				authorized.push(...page.entries.filter(artifact => ids.has(artifact.id)));

				// 3. Continue only while another stable page exists and the response limit is not full.
				cursor = page.nextCursor;
			}
			while (cursor !== null && authorized.length < _CATALOGUE_LIMIT);
			return authorized.slice(0, _CATALOGUE_LIMIT);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}
}
