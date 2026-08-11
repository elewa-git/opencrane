import { randomUUID } from "node:crypto";

import { ArtifactKind, ArtifactRevisionState, ArtifactState, ArtifactUploadLeaseState, ConversationAssetProvenance as PersistedProvenance, ConversationAssetState, ConversationLifecycle, OrgMemberStatus, type Prisma } from "@prisma/client";

import { ___ConversationAssetMediaDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

import type { ConversationAssetRepository, ConversationAssetUploadTarget } from "./conversation-asset.repository.types.js";
import type { ConversationAssetCaller, ConversationAssetResult, ConversationAssetView, ReserveConversationAssetRequest } from "./conversation-asset.types.js";

/** Transaction-scoped conversation asset repository. */
export class PrismaConversationAssetRepository implements ConversationAssetRepository
{
	private readonly transaction: Prisma.TransactionClient;

	/** Binds all delegates to one already-open transaction. */
	constructor(transaction: Prisma.TransactionClient) { this.transaction = transaction; }

	/** Reserves one logical artifact, hidden write lease, and browser asset row. */
	async reserve(caller: ConversationAssetCaller, conversationId: string, request: ReserveConversationAssetRequest): Promise<ConversationAssetResult>
	{
		if (!await this._canAccessConversation(caller, conversationId)) return { outcome: "denied", reason: "conversation_unavailable" };
		const existing = await this.transaction.conversationAsset.findUnique({ where: { conversationId_createdByUserId_idempotencyKey: { conversationId, createdByUserId: caller.subjectId, idempotencyKey: request.idempotencyKey } } });
		if (existing !== null) return _ReservationMatches(existing, request) ? { outcome: "idempotent", asset: _View(existing, caller.subjectId) } : { outcome: "denied", reason: "idempotency_conflict" };
		const artifactId = randomUUID();
		const leaseId = randomUUID();
		await this.transaction.artifact.create({ data: { id: artifactId, siloId: caller.siloId, ownerPrincipalId: caller.subjectId, kind: ArtifactKind.Upload } });
		await this.transaction.artifactUploadLease.create({ data: { id: leaseId, artifactId, siloId: caller.siloId, capabilityJti: randomUUID(), expectedContentAddress: request.contentAddress, expectedByteLength: BigInt(request.byteLength), mediaType: request.mediaType, expiresAt: new Date(Date.now() + 15 * 60 * 1_000) } });
		const asset = await this.transaction.conversationAsset.create({ data: { id: randomUUID(), siloId: caller.siloId, conversationId, artifactId, uploadLeaseId: leaseId, idempotencyKey: request.idempotencyKey, provenance: PersistedProvenance.ParticipantUpload, state: ConversationAssetState.Uploading, displayName: request.displayName.trim(), mediaType: request.mediaType, byteLength: BigInt(request.byteLength), createdByUserId: caller.subjectId } });
		return { outcome: "accepted", asset: _View(asset, caller.subjectId) };
	}

	/** Reads one live hidden upload lease. */
	async readUploadTarget(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetUploadTarget | null>
	{
		if (!await this._canAccessConversation(caller, conversationId)) return null;
		const asset = await this.transaction.conversationAsset.findFirst({ where: { id: assetId, siloId: caller.siloId, conversationId, createdByUserId: caller.subjectId, state: ConversationAssetState.Uploading }, include: { uploadLease: true } });
		const lease = asset?.uploadLease;
		if (lease === null || lease === undefined || lease.state !== ArtifactUploadLeaseState.Active || lease.expiresAt <= new Date() || lease.expectedContentAddress === null || lease.expectedByteLength === null) return null;
		return { lease: { leaseId: lease.id, siloId: lease.siloId, artifactId: lease.artifactId, action: "artifact.write", expiresAtEpochSeconds: Math.floor(lease.expiresAt.getTime() / 1_000), expectedContentAddress: lease.expectedContentAddress, expectedByteLength: Number(lease.expectedByteLength), mediaType: lease.mediaType } };
	}

	/** Converts a verified promotion into a quarantined revision and scan job. */
	async finalize(caller: ConversationAssetCaller, conversationId: string, assetId: string, promotion: import("@opencrane/backend/artifacts/authorization").ArtifactPromotionReceiptClaims, receiptDigest: string): Promise<ConversationAssetResult>
	{
		if (!await this._canAccessConversation(caller, conversationId)) return { outcome: "denied", reason: "conversation_unavailable" };
		const asset = await this.transaction.conversationAsset.findFirst({ where: { id: assetId, siloId: caller.siloId, conversationId, createdByUserId: caller.subjectId } });
		if (asset === null) return { outcome: "denied", reason: "asset_unavailable" };
		if (asset.state === ConversationAssetState.Processing || asset.state === ConversationAssetState.Ready) return { outcome: "idempotent", asset: _View(asset, caller.subjectId) };
		if (asset.state !== ConversationAssetState.Uploading || asset.uploadLeaseId !== promotion.leaseId || asset.artifactId === null) return { outcome: "denied", reason: "asset_unavailable" };
		const lease = await this.transaction.artifactUploadLease.findUnique({ where: { id: promotion.leaseId } });
		if (lease === null || lease.state !== ArtifactUploadLeaseState.Active || lease.expectedContentAddress !== promotion.contentAddress || lease.expectedByteLength !== BigInt(promotion.byteLength) || lease.mediaType !== promotion.mediaType) return { outcome: "denied", reason: "upload_failed" };
		const now = new Date();
		const revisionId = randomUUID();
		await this.transaction.artifactUploadLease.update({ where: { id: lease.id }, data: { state: ArtifactUploadLeaseState.Finalized, promotionReceiptDigest: receiptDigest, promotedContentAddress: promotion.contentAddress, promotedByteLength: BigInt(promotion.byteLength), promotedAt: now, finalizedAt: now } });
		await this.transaction.artifactRevision.create({ data: { id: revisionId, artifactId: asset.artifactId, revision: 1, state: ArtifactRevisionState.Quarantined, contentAddress: promotion.contentAddress, byteLength: BigInt(promotion.byteLength), mediaType: promotion.mediaType, provenance: { kind: "conversation_participant_upload", conversationAssetId: asset.id }, createdBy: caller.subjectId } });
		await this.transaction.artifactScanJob.create({ data: { artifactRevisionId: revisionId } });
		return { outcome: "accepted", asset: _View(await this.transaction.conversationAsset.update({ where: { id: asset.id }, data: { revisionId, state: ConversationAssetState.Processing } }), caller.subjectId) };
	}

	/** Removes only the caller's unlinked upload reservation and revokes its live write lease. */
	async remove(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetResult>
	{
		if (!await this._canAccessConversation(caller, conversationId)) return { outcome: "denied", reason: "conversation_unavailable" };
		const asset = await this.transaction.conversationAsset.findFirst({ where: { id: assetId, siloId: caller.siloId, conversationId, createdByUserId: caller.subjectId, provenance: PersistedProvenance.ParticipantUpload } });
		if (asset === null) return { outcome: "denied", reason: "asset_unavailable" };
		if (asset.state === ConversationAssetState.Removed) return { outcome: "idempotent", asset: _View(asset, caller.subjectId) };
		if (!_CanRemove(asset, caller.subjectId)) return { outcome: "denied", reason: "asset_unavailable" };
		const now = new Date();
		if (asset.uploadLeaseId !== null) await this.transaction.artifactUploadLease.updateMany({ where: { id: asset.uploadLeaseId, state: ArtifactUploadLeaseState.Active }, data: { state: ArtifactUploadLeaseState.Cancelled } });
		if (asset.artifactId !== null) await this.transaction.artifact.updateMany({ where: { id: asset.artifactId, state: ArtifactState.Active }, data: { state: ArtifactState.DeletionPending, deletedAt: now } });
		const removed = await this.transaction.conversationAsset.update({ where: { id: asset.id }, data: { state: ConversationAssetState.Removed, displayName: "Attachment removed", mediaType: "application/octet-stream", byteLength: null, failureCode: null, removedAt: now } });
		return { outcome: "accepted", asset: _View(removed, caller.subjectId) };
	}

	/** Lists browser-safe metadata for a current participant. */
	async list(caller: ConversationAssetCaller, conversationId: string): Promise<readonly ConversationAssetView[]>
	{
		if (!await this._canAccessConversation(caller, conversationId)) return [];
		return (await this.transaction.conversationAsset.findMany({ where: { conversationId, siloId: caller.siloId, state: { not: ConversationAssetState.Removed } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(function _SafeView(asset) { return _View(asset, caller.subjectId); });
	}

	/** Requires current silo membership and participant access. */
	private async _canAccessConversation(caller: ConversationAssetCaller, conversationId: string): Promise<boolean>
	{
		const participant = await this.transaction.conversationParticipant.findFirst({ where: { conversationId, userId: caller.subjectId, accessEndedPosition: null, conversation: { siloId: caller.siloId, lifecycle: ConversationLifecycle.Open } } });
		return participant !== null && await this.transaction.orgMembership.count({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active } }) === 1;
	}
}

/** Require an exact retry body for reservation idempotency. */
function _ReservationMatches(asset: { readonly displayName: string; readonly mediaType: string; readonly byteLength: bigint | null; readonly artifactId: string | null }, request: ReserveConversationAssetRequest): boolean
{
	return asset.displayName === request.displayName.trim() && asset.mediaType === request.mediaType && asset.byteLength === BigInt(request.byteLength) && asset.artifactId !== null;
}

/** Project a browser-safe view without technical authority facts. */
function _View(asset: { readonly id: string; readonly conversationId: string; readonly messageId: string | null; readonly provenance: PersistedProvenance; readonly state: ConversationAssetState; readonly displayName: string; readonly mediaType: string; readonly byteLength: bigint | null; readonly failureCode: string | null; readonly createdByUserId?: string | null; readonly revisionId?: string | null; readonly createdAt: Date }, subjectId: string): ConversationAssetView
{
	const provenance = asset.provenance === PersistedProvenance.ParticipantUpload ? ConversationAssetProvenance.ParticipantUpload : ConversationAssetProvenance.AgentOutput;
	return { id: asset.id, conversationId: asset.conversationId, messageId: asset.messageId, provenance, state: _Lifecycle(asset.state), displayName: asset.displayName, mediaType: asset.mediaType, byteLength: asset.byteLength === null ? null : Number(asset.byteLength), disposition: ___ConversationAssetMediaDisposition(asset.mediaType), failureCode: asset.failureCode, canRemove: _CanRemove(asset, subjectId), canRetry: false, createdAt: asset.createdAt.toISOString() };
}

/** Convert Prisma enum members to the public string-backed lifecycle. */
function _Lifecycle(state: ConversationAssetState): ConversationAssetLifecycle
{
	switch (state)
	{
		case ConversationAssetState.Uploading: return ConversationAssetLifecycle.Uploading;
		case ConversationAssetState.Processing: return ConversationAssetLifecycle.Processing;
		case ConversationAssetState.Ready: return ConversationAssetLifecycle.Ready;
		case ConversationAssetState.Failed: return ConversationAssetLifecycle.Failed;
		case ConversationAssetState.Cancelled: return ConversationAssetLifecycle.Cancelled;
		case ConversationAssetState.Removed: return ConversationAssetLifecycle.Removed;
	}
}

/** Removal is caller-specific and ends once a reservation is linked, uploaded, or agent-created. */
function _CanRemove(asset: { readonly provenance: PersistedProvenance; readonly state: ConversationAssetState; readonly messageId: string | null; readonly createdByUserId?: string | null; readonly revisionId?: string | null }, subjectId: string): boolean
{
	return asset.provenance === PersistedProvenance.ParticipantUpload && asset.createdByUserId === subjectId && asset.messageId === null && (asset.revisionId === null || asset.revisionId === undefined) && asset.state === ConversationAssetState.Uploading;
}
