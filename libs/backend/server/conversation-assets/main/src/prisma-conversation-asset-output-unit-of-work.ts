import { Prisma, type PrismaClient } from "@prisma/client";

import type { ArtifactServicePromotionPort, ArtifactUploadCryptoPort } from "@opencrane/backend/server/agents/artifacts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { ConversationAssetOutputDenialReasons, ConversationAssetOutputPublishOutcomes, ConversationAssetOutputReservationOutcomes, ConversationAssetOutputTargetStatuses, type ConversationAssetOutputAuthority, type ConversationAssetOutputPublishResult, type ConversationAssetOutputReservationResult, type ConversationAssetOutputRuntimeIdentity, type ReserveConversationAssetOutput } from "./conversation-asset-output.types.js";
import { _ParseReserveConversationAssetOutput } from "./conversation-asset-output.validator.js";
import { PrismaConversationAssetOutputRepository } from "./prisma-conversation-asset-output-repository.js";

/** Transaction owner and byte broker for generated conversation outputs. */
export class PrismaConversationAssetOutputUnitOfWork implements ConversationAssetOutputAuthority
{
	/** Root Prisma client used only to open reviewed output transactions. */
	private readonly prisma: PrismaClient;
	/** Private ArtifactStore promotion port that consumes signed write authority. */
	private readonly service: ArtifactServicePromotionPort;
	/** Lease signer and receipt verifier fixed by app composition. */
	private readonly crypto: ArtifactUploadCryptoPort;

	/** Creates the authority with its private ArtifactStore ports. */
	constructor(prisma: PrismaClient, service: ArtifactServicePromotionPort, crypto: ArtifactUploadCryptoPort) { this.prisma = prisma; this.service = service; this.crypto = crypto; }

	/** Reserves one retry-stable generated-output ticket without exposing storage authority. */
	async reserve(identity: ConversationAssetOutputRuntimeIdentity, command: ReserveConversationAssetOutput): Promise<ConversationAssetOutputReservationResult>
	{
		const normalized = _ParseReserveConversationAssetOutput(command);
		if (normalized === null) return { outcome: ConversationAssetOutputReservationOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.InvalidRequest };
		return ___DoWithTrace("conversation.asset.output.reserve", { runId: normalized.runId, runAttempt: normalized.runAttempt }, () => this._transaction(function _Reserve(repository) { return repository.reserve(identity, normalized); }, Prisma.TransactionIsolationLevel.Serializable));
	}

	/** Promotes the exact streamed bytes, verifies the receipt, then quarantines the output. */
	async publish(identity: ConversationAssetOutputRuntimeIdentity, ticketId: string, bytes: AsyncIterable<Uint8Array>): Promise<ConversationAssetOutputPublishResult>
	{
		return ___DoWithTrace("conversation.asset.output.publish", { ticketId }, async () =>
		{
			// 1. Read and reauthorize the live server-owned target before any bytes leave the server.
			const target = await this._transaction(function _Read(repository) { return repository.readUploadTarget(identity, ticketId); }, Prisma.TransactionIsolationLevel.RepeatableRead);
			if (target === null) return { outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.OutputUnavailable };
			if (target.status === ConversationAssetOutputTargetStatuses.Completed) return { outcome: ConversationAssetOutputPublishOutcomes.Idempotent };
			// 2. Promote the stream under an exact-content signed lease and verify ArtifactStore evidence.
			const receipt = await this.service.promote(this.crypto.signLease(target.lease), bytes);
			const promotion = this.crypto.verifyReceipt(receipt.receipt);
			if (promotion === null || promotion.leaseId !== target.lease.leaseId || promotion.contentAddress !== target.lease.expectedContentAddress || promotion.byteLength !== target.lease.expectedByteLength || promotion.mediaType !== target.lease.mediaType) return { outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.UploadFailed };
			// 3. Reauthorize the runtime and commit the verified receipt in a serializable transaction.
			const receiptDigest = this.crypto.digestReceipt(receipt.receipt);
			return this._transaction(function _Finalize(repository) { return repository.finalize(identity, ticketId, promotion, receiptDigest); }, Prisma.TransactionIsolationLevel.Serializable);
		});
	}

	/** Creates exactly one transaction-scoped repository for each durable operation. */
	private _transaction<Result>(work: (repository: PrismaConversationAssetOutputRepository) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel): Promise<Result>
	{
		return this.prisma.$transaction(async function _Transaction(transaction) { return work(new PrismaConversationAssetOutputRepository(transaction)); }, { isolationLevel });
	}
}
