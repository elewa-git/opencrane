import type { Prisma } from "@prisma/client";

import type { ResourceShareRecipientRecord, ResourceShareRepository } from "./resource-share-repository.types";
import { ResourceShareKinds, type ResourceShareRecord } from "./resource-share.types";

/** Prisma projection used for the public resource-share record. */
const _RESOURCE_SHARE_SELECT = {
	id: true,
	siloId: true,
	resourceKind: true,
	resourceId: true,
	ownerPrincipalId: true,
	recipients: { select: { principalId: true }, orderBy: { principalId: "asc" } },
} as const satisfies Prisma.ResourceShareSelect;

/** Prisma result mapped into the resource-share domain. */
type ResourceShareRow = Prisma.ResourceShareGetPayload<{ select: typeof _RESOURCE_SHARE_SELECT }>;

/** Maps a stored resource kind and fails when persistence contains an unknown category. */
function _resourceKind(value: string): ResourceShareKinds
{
	if (value === ResourceShareKinds.File) return ResourceShareKinds.File;
	if (value === ResourceShareKinds.Chat) return ResourceShareKinds.Chat;
	if (value === ResourceShareKinds.Dataset) return ResourceShareKinds.Dataset;
	throw new Error(`resource share contains unsupported resource kind ${value}`);
}

/** Maps the Prisma projection into the storage-neutral domain record. */
function _record(row: ResourceShareRow): ResourceShareRecord
{
	return {
		id: row.id,
		siloId: row.siloId,
		resourceKind: _resourceKind(row.resourceKind),
		resourceId: row.resourceId,
		ownerPrincipalId: row.ownerPrincipalId,
		recipientPrincipalIds: row.recipients.map(recipient => recipient.principalId),
	};
}

/** Persists explicit resource shares through a caller-owned Prisma transaction. */
export class PrismaResourceShareRepository implements ResourceShareRepository
{
	/** Transaction-scoped product-authority client. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Creates the adapter over the transaction supplied by the unit of work. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	/** Finds one recipient together with its resource owner and linked grant. */
	async findRecipient(siloId: string, shareId: string, recipientPrincipalId: string): Promise<ResourceShareRecipientRecord | null>
	{
		const row = await this._transaction.resourceShareRecipient.findUnique({
			where: { resourceShareId_principalId: { resourceShareId: shareId, principalId: recipientPrincipalId } },
			select: { principalId: true, grantId: true, share: { select: { id: true, siloId: true, ownerPrincipalId: true } } },
		});
		if (row === null || row.share.siloId !== siloId) return null;
		return { shareId: row.share.id, siloId: row.share.siloId, ownerPrincipalId: row.share.ownerPrincipalId, recipientPrincipalId: row.principalId, grantId: row.grantId };
	}

	/** Removes one recipient relation at the exact silo and share coordinates. */
	async revokeRecipient(siloId: string, shareId: string, recipientPrincipalId: string): Promise<boolean>
	{
		const result = await this._transaction.resourceShareRecipient.deleteMany({ where: { siloId, resourceShareId: shareId, principalId: recipientPrincipalId } });
		return result.count === 1;
	}

	/** Lists shares owned by or granted to the authenticated principal. */
	async listVisible(siloId: string, principalId: string): Promise<readonly ResourceShareRecord[]>
	{
		const rows = await this._transaction.resourceShare.findMany({
			where: { siloId, OR: [{ ownerPrincipalId: principalId }, { recipients: { some: { principalId } } }] },
			orderBy: { createdAt: "desc" },
			select: _RESOURCE_SHARE_SELECT,
		});
		return rows.map(_record);
	}
}
