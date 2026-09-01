import type { ResourceShareUnitOfWork } from "./resource-share-unit-of-work.types";
import { ResourceShareOutcomes, type ResourceShareCaller, type ResourceShareRecord, type RevokeResourceShareCommand, type RevokeResourceShareResult } from "./resource-share.types";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";
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
		return this._unitOfWork.execute(async function _list(transaction)
		{
			const candidates = await transaction.resourceShares.listVisible(caller.siloId, caller.principalId);
			const entitled = await transaction.authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: candidates.map(share => ({ kind: ProductAuthorizationResourceKinds.ResourceShare, id: share.id })), nowEpochMs: Date.now() });
			const ids = new Set(entitled.map(resource => resource.id));
			return candidates.filter(share => ids.has(share.id));
		});
	}

	/** Revokes the recipient relation and its manager-owned grant in one transaction. */
	async revoke(command: RevokeResourceShareCommand): Promise<RevokeResourceShareResult>
	{
		return this._unitOfWork.execute(async function _revoke(transaction): Promise<RevokeResourceShareResult>
		{
			// 1. Resolve the stored relation and owner so route parameters cannot select another silo.
			const recipient = await transaction.resourceShares.findRecipient(command.caller.siloId, command.shareId, command.recipientPrincipalId);
			if (recipient === null)
			{
				return { outcome: ResourceShareOutcomes.NotFound };
			}
			const admission = await transaction.authorization.admitPrincipal({ siloId: command.caller.siloId, principalId: command.caller.principalId, actorKind: "user", actorId: command.caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.ResourceShare, id: command.shareId }, action: ProductAuthorizationActions.Revoke, argumentsDigest: ___DigestCanonicalJson({ recipientPrincipalId: command.recipientPrincipalId }), nowEpochMs: Date.now() });
			if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
			{
				return { outcome: ResourceShareOutcomes.NotFound };
			}

			// 2. Remove the relation and soft-revoke its exact linked grant in one transaction. Either
			// mismatch throws and rolls the whole procedure back.
			const relationRevoked = await transaction.resourceShares.revokeRecipient(command.caller.siloId, command.shareId, command.recipientPrincipalId);
			const grantRevoked = await transaction.managedShareRevocations.revokeManagedShare(command.caller.siloId, _RESOURCE_SHARE_MANAGER_ID, recipient.ownerPrincipalId, recipient.grantId);
			if (!relationRevoked || !grantRevoked)
			{
				throw new Error("resource recipient and linked grant diverged during revocation");
			}
			await transaction.managedAuthorizationGrants.reconcileManagedResourceGrants({ siloId: command.caller.siloId, managerId: `resource-share-recipient-access:${command.recipientPrincipalId}`, resource: { kind: ProductAuthorizationResourceKinds.ResourceShare, id: command.shareId }, grants: [], now: new Date() });
			return { outcome: ResourceShareOutcomes.Revoked };
		});
	}
}
