import { __ResolvePrincipalAuthorization } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds } from "@opencrane/models/authorization";

import type { ResourceShareUnitOfWork } from "./resource-share-unit-of-work.types";
import { ResourceShareOutcomes, type CreateResourceShareCommand, type CreateResourceShareResult, type ResourceShareCaller, type ResourceShareRecord, type RevokeResourceShareCommand, type RevokeResourceShareResult } from "./resource-share.types";

/** Published catalog that defines direct resource reading. */
const _RESOURCE_SHARE_CATALOG_ID = "opencrane-resource-sharing";
/** Published revision that defines direct resource reading. */
const _RESOURCE_SHARE_CATALOG_REVISION = 1;
/** Capability granted to each explicit resource recipient. */
const _RESOURCE_SHARE_CAPABILITY_ID = "resource:read";
/** Grant priority reserved for direct resource sharing. */
const _RESOURCE_SHARE_PRIORITY = 0;
/** Bounded manager that owns grants linked from ResourceShareRecipient rows. */
const _RESOURCE_SHARE_MANAGER_ID = "resource-share-editor";

/** Owns explicit resource-share policy and coordinates each atomic persistence command. */
export class ResourceShareService
{
	/** Transaction boundary used for every read and write procedure. */
	private readonly _unitOfWork: ResourceShareUnitOfWork;

	/** Creates the service around the application-composed unit of work. */
	constructor(unitOfWork: ResourceShareUnitOfWork) { this._unitOfWork = unitOfWork; }

	/** Creates one recipient relation only while the caller still holds the resource grant. */
	async create(command: CreateResourceShareCommand): Promise<CreateResourceShareResult>
	{
		return this._unitOfWork.execute(async function _create(transaction): Promise<CreateResourceShareResult>
		{
			// 1. Resolve persisted participants and the immutable capability inside the transaction so
			// missing or cross-silo authority cannot create a partial share.
			const [existingShare, recipientExists, capability] = await Promise.all([
				transaction.resourceShares.findByResource(command.caller.siloId, command.resourceKind, command.resourceId),
				transaction.resourceShares.principalExists(command.caller.siloId, command.recipientPrincipalId),
				transaction.capabilityCatalog.findCapability(_RESOURCE_SHARE_CATALOG_ID, _RESOURCE_SHARE_CATALOG_REVISION, _RESOURCE_SHARE_CAPABILITY_ID),
			]);
			if (!recipientExists || capability === null) return { outcome: ResourceShareOutcomes.NotFound };
			const ownerPrincipalId = existingShare?.ownerPrincipalId ?? command.caller.principalId;
			if (ownerPrincipalId !== command.caller.principalId) return { outcome: ResourceShareOutcomes.Forbidden };

			// 2. Re-evaluate the caller's live grant before writing. A resource identifier or existing
			// ResourceShare row does not prove that the caller may delegate access.
			const decision = await __ResolvePrincipalAuthorization(transaction.authorization, {
				siloId: command.caller.siloId,
				principalId: command.caller.principalId,
				boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: ownerPrincipalId },
				capability,
				resource: { kind: command.resourceKind, id: command.resourceId },
				nowEpochMs: command.nowEpochMs,
			});
			if (decision.outcome !== AuthorizationDecisionOutcomes.Allow) return { outcome: ResourceShareOutcomes.Forbidden };

			// 3. Establish the resource parent after authorization, then reject a concurrent owner change.
			const share = await transaction.resourceShares.createOrFind({
				siloId: command.caller.siloId,
				resourceKind: command.resourceKind,
				resourceId: command.resourceId,
				ownerPrincipalId,
			});
			if (share.ownerPrincipalId !== command.caller.principalId) return { outcome: ResourceShareOutcomes.Forbidden };
			const existingRecipient = await transaction.resourceShares.findRecipient(command.caller.siloId, share.id, command.recipientPrincipalId);
			if (existingRecipient !== null) return { outcome: ResourceShareOutcomes.Existing, share };

			// 4. Pair the explicit recipient with its exact generic grant in this same transaction. A
			// failure rolls back both authorities, so neither can exist without the other.
			const grant = await transaction.authorizationShares.createOrFindExactShare({
				siloId: command.caller.siloId,
				managerId: _RESOURCE_SHARE_MANAGER_ID,
				subject: { kind: AuthorizationSubjectKinds.Principal, principalId: command.recipientPrincipalId },
				boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: ownerPrincipalId },
				boundaryCoverage: AuthorizationBoundaryCoverages.Exact,
				catalogId: capability.catalog.catalogId,
				catalogRevision: capability.catalog.revision,
				catalogDigest: capability.catalog.digest,
				capabilityId: capability.capabilityId,
				resourceKind: command.resourceKind,
				resourceId: command.resourceId,
				priority: _RESOURCE_SHARE_PRIORITY,
				createdByPrincipalId: command.caller.principalId,
			});
			const created = await transaction.resourceShares.createRecipient({
				siloId: command.caller.siloId,
				shareId: share.id,
				recipientPrincipalId: command.recipientPrincipalId,
				grantedByPrincipalId: command.caller.principalId,
				grantId: grant.share.id,
			});
			const current = await transaction.resourceShares.findById(command.caller.siloId, share.id);
			if (current === null) throw new Error("resource share disappeared during recipient creation");
			return { outcome: created ? ResourceShareOutcomes.Created : ResourceShareOutcomes.Existing, share: current };
		});
	}

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
