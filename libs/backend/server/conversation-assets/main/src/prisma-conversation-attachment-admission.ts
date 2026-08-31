import { ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";

import { ___CONVERSATION_ASSET_MAX_FILES, ___CONVERSATION_ASSET_MAX_TOTAL_BYTES, ___IsSupportedConversationAssetMediaType } from "@opencrane/models/conversation-assets";
import type { ConversationAttachmentAdmissionPort } from "@opencrane/backend/server/conversations";
import { MessageContentBlockKinds, type MessageContentBlock } from "@opencrane/models/conversations";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { PrismaConversationAssetProductAuthorizationRepository } from "./conversation-asset-product-authorization";

/** Transaction-scoped attachment binder used by ordinary and run message admission. */
export class PrismaConversationAttachmentAdmissionRepository implements ConversationAttachmentAdmissionPort
{
	private readonly transaction: Prisma.TransactionClient;
	private readonly authorization: PrismaConversationAssetProductAuthorizationRepository;

	/** Binds this adapter to the already-open message transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.authorization = new PrismaConversationAssetProductAuthorizationRepository(transaction);
	}

	/** Binds only caller-owned ready assets and rejects the complete message on any mismatch. */
	async bindReadyAssets(caller: { readonly siloId: string; readonly principalId: string; readonly subjectId: string }, conversationId: string, messageId: string, blocks: readonly MessageContentBlock[]): Promise<void>
	{
		const assetIds = blocks.filter(function _Artifact(block): boolean { return block.kind === MessageContentBlockKinds.Artifact; }).map(function _AssetId(block): string { return block.value; });
		if (assetIds.length === 0) return;
		if (assetIds.length > ___CONVERSATION_ASSET_MAX_FILES || new Set(assetIds).size !== assetIds.length) throw new Error("Conversation attachment set is invalid");
		const assets = await this.transaction.conversationAsset.findMany({ where: { id: { in: assetIds }, siloId: caller.siloId, conversationId, createdByUserId: caller.subjectId, provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetState.Ready, messageId: null }, select: { id: true, artifactId: true, mediaType: true, byteLength: true } });
		const totalBytes = assets.reduce(function _Total(sum, asset): bigint { return sum + (asset.byteLength ?? 0n); }, 0n);
		if (assets.length !== assetIds.length || totalBytes > BigInt(___CONVERSATION_ASSET_MAX_TOTAL_BYTES) || assets.some(function _Unsupported(asset): boolean { return !___IsSupportedConversationAssetMediaType(asset.mediaType); })) throw new Error("Conversation attachment authority unavailable");
		for (const asset of assets)
		{
			if (asset.artifactId === null || !await this.authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Artifact, id: asset.artifactId }, ProductAuthorizationActions.Edit, { assetId: asset.id, conversationId, messageId }))
				throw new Error("Conversation attachment product authorization unavailable");
		}
		const changed = await this.transaction.conversationAsset.updateMany({ where: { id: { in: assetIds }, messageId: null, state: ConversationAssetState.Ready }, data: { messageId } });
		if (changed.count !== assetIds.length) throw new Error("Conversation attachment authority changed");
	}

	/** Mirrors logical asset references into a child conversation while reusing immutable Artifact bytes. */
	async mirrorReadyAssets(caller: { readonly siloId: string; readonly principalId: string; readonly subjectId: string }, parentConversationId: string, childConversationId: string, childMessageId: string, parentBlocks: readonly MessageContentBlock[], childBlocks: readonly MessageContentBlock[]): Promise<void>
	{
		const parentIds = _ArtifactIds(parentBlocks);
		const childIds = _ArtifactIds(childBlocks);
		if (parentIds.length === 0 && childIds.length === 0) return;
		if (parentIds.length !== childIds.length || new Set(childIds).size !== childIds.length) throw new Error("Agent-thread attachment mapping is invalid");
		const assets = await this.transaction.conversationAsset.findMany({ where: { id: { in: [...parentIds] }, siloId: caller.siloId, conversationId: parentConversationId, createdByUserId: caller.subjectId, provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetState.Ready, messageId: { not: null } }, select: { id: true, artifactId: true, revisionId: true, displayName: true, mediaType: true, byteLength: true } });
		const byId = new Map(assets.map(function _Pair(asset): readonly [string, typeof asset] { return [asset.id, asset]; }));
		for (let index = 0; index < parentIds.length; index += 1)
		{
			const parentId = parentIds[index];
			const childId = childIds[index];
			const asset = parentId === undefined ? undefined : byId.get(parentId);
			if (asset === undefined || childId === undefined || asset.artifactId === null || asset.revisionId === null || asset.byteLength === null) throw new Error("Agent-thread attachment authority unavailable");
			if (!await this.authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Artifact, id: asset.artifactId }, ProductAuthorizationActions.Edit, { childConversationId, childMessageId, parentConversationId, sourceAssetId: asset.id }))
				throw new Error("Agent-thread attachment product authorization unavailable");
			await this.transaction.conversationAsset.create({ data: { id: childId, siloId: caller.siloId, conversationId: childConversationId, messageId: childMessageId, idempotencyKey: `agent-thread:${parentId}`, provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetState.Ready, displayName: asset.displayName, mediaType: asset.mediaType, byteLength: asset.byteLength, artifactId: asset.artifactId, revisionId: asset.revisionId, createdByUserId: caller.subjectId } });
		}
	}
}

function _ArtifactIds(blocks: readonly MessageContentBlock[]): readonly string[]
{
	return blocks.filter(function _Artifact(block): boolean { return block.kind === MessageContentBlockKinds.Artifact; }).map(function _AssetId(block): string { return block.value; });
}
