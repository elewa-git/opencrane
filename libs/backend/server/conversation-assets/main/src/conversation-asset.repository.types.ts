import type { ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";
import type { ArtifactPromotionReceiptClaims } from "@opencrane/backend/artifacts/authorization";

import type { ConversationAssetCaller, ConversationAssetResult, ConversationAssetView, ReserveConversationAssetRequest } from "./conversation-asset.types";
import type { ConversationAssetReadTarget } from "./conversation-asset-content.types";

/** Internal upload target kept behind the server authority. */
export interface ConversationAssetUploadTarget { readonly lease: ArtifactWriteLeaseClaims; }

/** Transaction-scoped conversation asset persistence. */
export interface ConversationAssetRepository
{
	reserve(caller: ConversationAssetCaller, conversationId: string, request: ReserveConversationAssetRequest): Promise<ConversationAssetResult>;
	readUploadTarget(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetUploadTarget | null>;
	finalize(caller: ConversationAssetCaller, conversationId: string, assetId: string, promotion: ArtifactPromotionReceiptClaims, receiptDigest: string): Promise<ConversationAssetResult>;
	remove(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetResult>;
	list(caller: ConversationAssetCaller, conversationId: string): Promise<readonly ConversationAssetView[]>;
	readReadyTarget(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetReadTarget | null>;
}
