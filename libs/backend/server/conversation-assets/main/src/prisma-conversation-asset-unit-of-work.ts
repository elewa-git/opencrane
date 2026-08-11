import { Prisma, type PrismaClient } from "@prisma/client";

import type { ArtifactServicePromotionPort, ArtifactUploadCryptoPort } from "@opencrane/backend/server/agents/artifacts";
import { ___DecideConversationAssetBatch } from "@opencrane/models/conversation-assets";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ConversationAssetCaller, ConversationAssetResult, ConversationAssetView, ReserveConversationAssetRequest } from "./conversation-asset.types.js";
import type { ConversationAssetUnitOfWork } from "./conversation-asset.router.types.js";
import { PrismaConversationAssetRepository } from "./prisma-conversation-asset-repository.js";

/** Transaction owner around server-brokered participant uploads. */
export class PrismaConversationAssetUnitOfWork implements ConversationAssetUnitOfWork
{
	private readonly prisma: PrismaClient;
	private readonly service: ArtifactServicePromotionPort;
	private readonly crypto: ArtifactUploadCryptoPort;

	/** Creates the unit of work and its external byte-store ports. */
	constructor(prisma: PrismaClient, service: ArtifactServicePromotionPort, crypto: ArtifactUploadCryptoPort) { this.prisma = prisma; this.service = service; this.crypto = crypto; }

	/** Reserves one hidden upload transaction. */
	async reserveUpload(caller: ConversationAssetCaller, conversationId: string, request: ReserveConversationAssetRequest): Promise<ConversationAssetResult>
	{
		if (!_ValidReservation(request)) return { outcome: "denied", reason: "invalid_request" };
		return this._transaction(function _Reserve(repository) { return repository.reserve(caller, conversationId, request); }, Prisma.TransactionIsolationLevel.Serializable);
	}

	/** Promotes exact bytes outside a transaction, then quarantines the receipt atomically. */
	async upload(caller: ConversationAssetCaller, conversationId: string, assetId: string, bytes: AsyncIterable<Uint8Array>): Promise<ConversationAssetResult>
	{
		const target = await this._transaction(function _Read(repository) { return repository.readUploadTarget(caller, conversationId, assetId); }, Prisma.TransactionIsolationLevel.RepeatableRead);
		if (target === null) return { outcome: "denied", reason: "asset_unavailable" };
		const receipt = await this.service.promote(this.crypto.signLease(target.lease), bytes);
		const promotion = this.crypto.verifyReceipt(receipt.receipt);
		if (promotion === null || promotion.leaseId !== target.lease.leaseId || promotion.contentAddress !== target.lease.expectedContentAddress || promotion.byteLength !== target.lease.expectedByteLength || promotion.mediaType !== target.lease.mediaType) return { outcome: "denied", reason: "upload_failed" };
		const receiptDigest = this.crypto.digestReceipt(receipt.receipt);
		return this._transaction(function _Finalize(repository) { return repository.finalize(caller, conversationId, assetId, promotion, receiptDigest); }, Prisma.TransactionIsolationLevel.Serializable);
	}

	/** Lists current browser-safe asset metadata. */
	async list(caller: ConversationAssetCaller, conversationId: string): Promise<readonly ConversationAssetView[]>
	{
		return this._transaction(function _List(repository) { return repository.list(caller, conversationId); }, Prisma.TransactionIsolationLevel.RepeatableRead);
	}

	/** Revokes one server-authorized unlinked upload reservation. */
	async remove(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetResult>
	{
		return this._transaction(function _Remove(repository) { return repository.remove(caller, conversationId, assetId); }, Prisma.TransactionIsolationLevel.Serializable);
	}

	/** Creates the transaction-scoped repository exactly once per operation. */
	private _transaction<Result>(work: (repository: PrismaConversationAssetRepository) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel): Promise<Result>
	{
		return this.prisma.$transaction(async function _Transaction(transaction)
		{
			return work(new PrismaConversationAssetRepository(transaction));
		}, { isolationLevel });
	}
}

/** Validate one upload reservation without persistence. */
function _ValidReservation(request: ReserveConversationAssetRequest): boolean
{
	return request.idempotencyKey.trim().length >= 1 && request.idempotencyKey.trim().length <= 128 && request.displayName.trim().length >= 1 && request.displayName.trim().length <= 255 && ___IsSha256ContentAddress(request.contentAddress) && ___DecideConversationAssetBatch([{ mediaType: request.mediaType, byteLength: request.byteLength }]).accepted;
}
