import type { Prisma } from "@prisma/client";

import type { AuthorizationResourceGrantRetirementRepository, RetireAuthorizationResourceGrantsCommand } from "./authorization-resource-grant-retirement.types";

/** Implements resource-grant retirement through the owning product transaction. */
export class PrismaAuthorizationResourceGrantRetirementRepository implements AuthorizationResourceGrantRetirementRepository
{
	/** Product-authority transaction shared with the resource deletion. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds exact-resource grant retirement to the caller's open transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async retireResourceGrants(command: RetireAuthorizationResourceGrantsCommand): Promise<number>
	{
		if (command.resources.length === 0)
			return 0;
		const exactResources = command.resources.map(function _Resource(resource) { return { resourceKind: resource.kind, resourceId: resource.id }; });
		const retired = await this.transaction.authorizationGrant.updateMany({ where: { siloId: command.siloId, revokedAt: null, OR: exactResources }, data: { revokedAt: command.now } });
		return retired.count;
	}
}
