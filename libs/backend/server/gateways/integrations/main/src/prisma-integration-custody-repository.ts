import { IntegrationCustodyState, IntegrationState, Prisma, type PrismaClient } from "@prisma/client";

import type { IntegrationCustodyRepository } from "./integration-custody-provisioning.types";

/**
 * Records an Obot-issued custody handle in Postgres, but only after re-checking that the
 * integration is still an active row in the same silo.
 *
 * The re-check matters because time passed while the request was out at Obot: the integration
 * could have been retired or moved in the meantime. Locking the integration row and checking again
 * inside the transaction is what makes that race safe — and when the check fails the write throws,
 * which is how `__ProvisionIntegrationCustody` knows to revoke the remote custody.
 *
 * Called by: constructed in `_CreateIntegrationCustodyRouter` (./integration-custody.router.ts)
 * and passed to `__ProvisionIntegrationCustody`.
 */
export class PrismaIntegrationCustodyRepository implements IntegrationCustodyRepository
{
	/** Canonical product database authority. */
	private readonly prisma: PrismaClient;

	/** Creates the custody projection adapter. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Lock the integration row, confirm it is still active in this silo and still names this
	 * catalogue entry, then insert the Ready custody row.
	 *
	 * @param command - Silo, integration, catalogue entry, Obot's reference, and its expiry.
	 * @returns The id of the custody row created.
	 * @throws Error "integration authority changed" when the integration was deleted, moved to
	 *         another silo, deactivated, or re-pointed at a different catalogue entry while the
	 *         Obot call was in flight. The caller responds by revoking the remote custody.
	 */
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
