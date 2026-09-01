import type { Prisma } from "@prisma/client";

import type { ManagedShareRevocationRepository } from "./managed-share-revocation-repository.types";

/** Implements managed share-grant revocation through the resource-share transaction. */
export class PrismaManagedShareRevocationRepository implements ManagedShareRevocationRepository
{
	/** Product-authority client shared with the surrounding transaction. */
	private readonly _prisma: Prisma.TransactionClient;

	/** Constructs the adapter around a transaction-scoped product-authority client. */
	constructor(prisma: Prisma.TransactionClient) { this._prisma = prisma; }

	/** Soft-revokes one grant only when the bounded manager and creating Principal both own it. */
	async revokeManagedShare(siloId: string, managerId: string, createdByPrincipalId: string, grantId: string): Promise<boolean>
	{
		const revoked = await this._prisma.authorizationGrant.updateMany({ where: { id: grantId, siloId, managerId, createdBy: createdByPrincipalId, revokedAt: null }, data: { revokedAt: new Date() } });
		return revoked.count === 1;
	}
}
