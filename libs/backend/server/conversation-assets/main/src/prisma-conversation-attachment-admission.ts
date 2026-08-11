import { ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";

import { ___CONVERSATION_ASSET_MAX_FILES, ___CONVERSATION_ASSET_MAX_TOTAL_BYTES, ___IsSupportedConversationAssetMediaType } from "@opencrane/models/conversation-assets";
import { MessageContentBlockKinds, type MessageContentBlock } from "@opencrane/models/conversations";

import type { ConversationAttachmentAdmissionRepository } from "./conversation-attachment-admission.repository.types.js";

/** Transaction-scoped attachment binder used by ordinary and run message admission. */
export class PrismaConversationAttachmentAdmissionRepository implements ConversationAttachmentAdmissionRepository
{
	private readonly transaction: Prisma.TransactionClient;

	/** Binds this adapter to the already-open message transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Binds only caller-owned ready assets and rejects the complete message on any mismatch. */
	async bindReadyAssets(caller: { readonly siloId: string; readonly subjectId: string }, conversationId: string, messageId: string, blocks: readonly MessageContentBlock[]): Promise<void>
	{
		const assetIds = blocks.filter(function _Artifact(block): boolean { return block.kind === MessageContentBlockKinds.Artifact; }).map(function _AssetId(block): string { return block.value; });
		if (assetIds.length === 0) return;
		if (assetIds.length > ___CONVERSATION_ASSET_MAX_FILES || new Set(assetIds).size !== assetIds.length) throw new Error("Conversation attachment set is invalid");
		const assets = await this.transaction.conversationAsset.findMany({ where: { id: { in: assetIds }, siloId: caller.siloId, conversationId, createdByUserId: caller.subjectId, provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetState.Ready, messageId: null }, select: { id: true, mediaType: true, byteLength: true } });
		const totalBytes = assets.reduce(function _Total(sum, asset): bigint { return sum + (asset.byteLength ?? 0n); }, 0n);
		if (assets.length !== assetIds.length || totalBytes > BigInt(___CONVERSATION_ASSET_MAX_TOTAL_BYTES) || assets.some(function _Unsupported(asset): boolean { return !___IsSupportedConversationAssetMediaType(asset.mediaType); })) throw new Error("Conversation attachment authority unavailable");
		const changed = await this.transaction.conversationAsset.updateMany({ where: { id: { in: assetIds }, messageId: null, state: ConversationAssetState.Ready }, data: { messageId } });
		if (changed.count !== assetIds.length) throw new Error("Conversation attachment authority changed");
	}
}
