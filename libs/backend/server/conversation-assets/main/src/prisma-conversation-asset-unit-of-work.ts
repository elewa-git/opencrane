import { Prisma, type PrismaClient } from "@prisma/client";

import type { ArtifactServicePromotionPort, ArtifactUploadCryptoPort } from "@opencrane/backend/server/agents/artifacts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ConversationAssetDenialReasons, type ConversationAssetCaller, type ConversationAssetResult, type ConversationAssetView, type ReserveConversationAssetRequest } from "./conversation-asset.types";
import type { ConversationAssetContent, ConversationAssetContentBroker } from "./conversation-asset-content.types";
import type { ConversationAssetAuthority } from "./conversation-asset.router.types";
import { _ParseReserveConversationAsset } from "./conversation-asset.validator";
import { PrismaConversationAssetRepository } from "./prisma-conversation-asset-repository";

/** Transaction owner around server-brokered participant uploads. */
export class PrismaConversationAssetUnitOfWork implements ConversationAssetAuthority
{
	private readonly prisma: PrismaClient;
	private readonly service: ArtifactServicePromotionPort;
	private readonly crypto: ArtifactUploadCryptoPort;
	private readonly contentBroker: ConversationAssetContentBroker;
	private readonly scannerAvailable: boolean;

	/** Creates the unit of work and its external byte-store ports. */
	constructor(prisma: PrismaClient, service: ArtifactServicePromotionPort, crypto: ArtifactUploadCryptoPort, contentBroker: ConversationAssetContentBroker, scannerAvailable = true) { this.prisma = prisma; this.service = service; this.crypto = crypto; this.contentBroker = contentBroker; this.scannerAvailable = scannerAvailable; }

	/** Reserves one hidden upload transaction. */
	async reserveUpload(caller: ConversationAssetCaller, conversationId: string, request: ReserveConversationAssetRequest): Promise<ConversationAssetResult>
	{
		if (!this.scannerAvailable) return { outcome: "denied", reason: ConversationAssetDenialReasons.ScannerUnavailable };
		const reservation = _ParseReserveConversationAsset(request);
		if (reservation === null) return { outcome: "denied", reason: "invalid_request" };
		return ___DoWithTrace("conversation.asset.reserve", { conversationId }, () => this._transaction(function _Reserve(repository) { return repository.reserve(caller, conversationId, reservation); }, Prisma.TransactionIsolationLevel.Serializable));
	}

	/** Promotes exact bytes outside a transaction, then quarantines the receipt atomically. */
	async upload(caller: ConversationAssetCaller, conversationId: string, assetId: string, bytes: AsyncIterable<Uint8Array>): Promise<ConversationAssetResult>
	{
		if (!this.scannerAvailable) return { outcome: "denied", reason: ConversationAssetDenialReasons.ScannerUnavailable };
		return ___DoWithTrace("conversation.asset.upload", { conversationId, assetId }, async () =>
		{
			const target = await this._transaction(function _Read(repository) { return repository.readUploadTarget(caller, conversationId, assetId); }, Prisma.TransactionIsolationLevel.RepeatableRead);
			if (target === null) return { outcome: "denied", reason: "asset_unavailable" };
			const receipt = await this.service.promote(this.crypto.signLease(target.lease), bytes);
			const promotion = this.crypto.verifyReceipt(receipt.receipt);
			if (promotion === null || promotion.leaseId !== target.lease.leaseId || promotion.contentAddress !== target.lease.expectedContentAddress || promotion.byteLength !== target.lease.expectedByteLength || promotion.mediaType !== target.lease.mediaType) return { outcome: "denied", reason: "upload_failed" };
			const receiptDigest = this.crypto.digestReceipt(receipt.receipt);
			return this._transaction(function _Finalize(repository) { return repository.finalize(caller, conversationId, assetId, promotion, receiptDigest); }, Prisma.TransactionIsolationLevel.Serializable);
		});
	}

	/** Lists current browser-safe asset metadata. */
	async list(caller: ConversationAssetCaller, conversationId: string): Promise<readonly ConversationAssetView[]>
	{
		return ___DoWithTrace("conversation.asset.list", { conversationId }, () => this._transaction(function _List(repository) { return repository.list(caller, conversationId); }, Prisma.TransactionIsolationLevel.RepeatableRead));
	}

	/** Reloads participant access and ready state before opening exact published bytes. */
	async read(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetContent | null>
	{
		return ___DoWithTrace("conversation.asset.read", { conversationId, assetId }, async () =>
		{
			const target = await this._transaction(function _Read(repository) { return repository.readReadyTarget(caller, conversationId, assetId); }, Prisma.TransactionIsolationLevel.RepeatableRead);
			if (target === null) return null;
			const bytes = await this.contentBroker.open(target);
			return bytes === null ? null : { displayName: target.displayName, mediaType: target.mediaType, byteLength: target.byteLength, disposition: target.disposition, bytes };
		});
	}

	/** Revokes one server-authorized unlinked upload reservation. */
	async remove(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetResult>
	{
		return ___DoWithTrace("conversation.asset.remove", { conversationId, assetId }, () => this._transaction(function _Remove(repository) { return repository.remove(caller, conversationId, assetId); }, Prisma.TransactionIsolationLevel.Serializable));
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
