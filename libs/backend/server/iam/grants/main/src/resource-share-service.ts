import type { ResourceShareUnitOfWork } from "./resource-share-unit-of-work.types";
import { ResourceShareOutcomes, type ResourceShareCaller, type ResourceShareRecord, type RevokeResourceShareCommand, type RevokeResourceShareResult } from "./resource-share.types";
/** Bounded manager that owns grants linked from ResourceShareRecipient rows. */
const _RESOURCE_SHARE_MANAGER_ID = "resource-share-editor";

/** Owns explicit resource-share policy and coordinates each atomic persistence command. */
export class ResourceShareService
{
	/** Transaction boundary used for every read and write procedure. */
	private readonly _unitOfWork: ResourceShareUnitOfWork;

	/** Creates the service around the application-composed unit of work. */
	constructor(unitOfWork: ResourceShareUnitOfWork) { this._unitOfWork = unitOfWork; }

	/** Lists every share visible to one authenticated local principal. */
	async list(caller: ResourceShareCaller): Promise<readonly ResourceShareRecord[]>
	{
		return this._unitOfWork.execute(function _list(transaction)
		{
			return transaction.resourceShares.listVisible(caller.siloId, caller.principalId);
		});
	}

	/** Revokes the recipient relation and its manager-owned grant in one transaction. */
	async revoke(command: RevokeResourceShareCommand): Promise<RevokeResourceShareResult>
	{
		return this._unitOfWork.execute(async function _revoke(transaction): Promise<RevokeResourceShareResult>
		{
			// 1. Resolve the stored relation and owner so route parameters cannot select another silo.
			const recipient = await transaction.resourceShares.findRecipient(command.caller.siloId, command.shareId, command.recipientPrincipalId);
			if (recipient === null || recipient.ownerPrincipalId !== command.caller.principalId) return { outcome: ResourceShareOutcomes.NotFound };

			// 2. Remove the relation and soft-revoke its exact linked grant in one transaction. Either
			// mismatch throws and rolls the whole procedure back.
			const relationRevoked = await transaction.resourceShares.revokeRecipient(command.caller.siloId, command.shareId, command.recipientPrincipalId);
			const grantRevoked = await transaction.authorizationShares.revokeManagedShare(command.caller.siloId, _RESOURCE_SHARE_MANAGER_ID, command.caller.principalId, recipient.grantId);
			if (!relationRevoked || !grantRevoked) throw new Error("resource recipient and linked grant diverged during revocation");
			return { outcome: ResourceShareOutcomes.Revoked };
		});
	}
}
