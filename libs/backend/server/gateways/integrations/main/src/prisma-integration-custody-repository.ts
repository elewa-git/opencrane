import { IntegrationCustodyState, IntegrationState, Prisma, type PrismaClient } from "@prisma/client";

import type { IntegrationCustodyRepository } from "./integration-custody-provisioning.types.js";

/** Prisma persistence adapter that accepts custody only for an active exact-silo Integration. */
export class PrismaIntegrationCustodyRepository implements IntegrationCustodyRepository
{
	/** Canonical product database authority. */
	private readonly prisma: PrismaClient;

	/** Creates the custody projection adapter. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Rechecks active same-silo integration authority before recording a remotely issued reference. */
	async persistReady(command: Parameters<IntegrationCustodyRepository["persistReady"]>[0]): Promise<{ readonly custodyReferenceId: string }>
	{
		return this.prisma.$transaction(async function _persist(transaction: Prisma.TransactionClient)
		{
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "integrations" WHERE "id" = ${command.integrationId} FOR UPDATE`);
			const integration = await transaction.integration.findUnique({ where: { id: command.integrationId } });
			if (integration === null || integration.siloId !== command.siloId || integration.state !== IntegrationState.Active || integration.obotCatalogEntryId !== command.obotCatalogEntryId) throw new Error("integration authority changed");
			const reference = await transaction.integrationCustodyReference.create({ data: { integrationId: command.integrationId, siloId: command.siloId, obotCustodyReference: command.obotCustodyReference, state: IntegrationCustodyState.Ready, expiresAt: command.expiresAt } });
			return { custodyReferenceId: reference.id };
		});
	}
}
