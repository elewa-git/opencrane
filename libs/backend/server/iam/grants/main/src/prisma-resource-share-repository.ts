import type { Prisma } from "@prisma/client";

import type { CreateResourceShareRecipientRecord, CreateResourceShareRecord, ResourceShareRecipientRecord, ResourceShareRepository } from "./resource-share-repository.types";
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

	/** Confirms that one principal belongs to the exact silo. */
	async principalExists(siloId: string, principalId: string): Promise<boolean>
	{
		const principal = await this._transaction.principal.findUnique({ where: { id_siloId: { id: principalId, siloId } }, select: { id: true } });
		return principal !== null;
	}

	/** Finds one share through its unique silo and resource coordinates. */
	async findByResource(siloId: string, resourceKind: ResourceShareKinds, resourceId: string): Promise<ResourceShareRecord | null>
	{
		const row = await this._transaction.resourceShare.findUnique({ where: { siloId_resourceKind_resourceId: { siloId, resourceKind, resourceId } }, select: _RESOURCE_SHARE_SELECT });
		return row === null ? null : _record(row);
	}

	/** Creates the share parent or returns the row already stored at these coordinates. */
	async createOrFind(input: CreateResourceShareRecord): Promise<ResourceShareRecord>
	{
		const row = await this._transaction.resourceShare.upsert({
			where: { siloId_resourceKind_resourceId: { siloId: input.siloId, resourceKind: input.resourceKind, resourceId: input.resourceId } },
			create: { siloId: input.siloId, resourceKind: input.resourceKind, resourceId: input.resourceId, ownerPrincipalId: input.ownerPrincipalId },
			update: {},
			select: _RESOURCE_SHARE_SELECT,
		});
		return _record(row);
	}

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

	/** Inserts the explicit recipient relation while tolerating an identical retry. */
	async createRecipient(input: CreateResourceShareRecipientRecord): Promise<boolean>
	{
		const result = await this._transaction.resourceShareRecipient.createMany({
			data: [{ siloId: input.siloId, resourceShareId: input.shareId, principalId: input.recipientPrincipalId, grantedByPrincipalId: input.grantedByPrincipalId, grantId: input.grantId }],
			skipDuplicates: true,
		});
		return result.count === 1;
	}

	/** Removes one recipient relation at the exact silo and share coordinates. */
	async revokeRecipient(siloId: string, shareId: string, recipientPrincipalId: string): Promise<boolean>
	{
		const result = await this._transaction.resourceShareRecipient.deleteMany({ where: { siloId, resourceShareId: shareId, principalId: recipientPrincipalId } });
		return result.count === 1;
	}

	/** Loads one complete current share projection. */
	async findById(siloId: string, shareId: string): Promise<ResourceShareRecord | null>
	{
		const row = await this._transaction.resourceShare.findUnique({ where: { id_siloId: { id: shareId, siloId } }, select: _RESOURCE_SHARE_SELECT });
		return row === null ? null : _record(row);
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
