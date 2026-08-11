import { InjectionToken } from "@angular/core";

import type { ConversationAsset, ReserveConversationAssetUpload } from "./conversation-assets.types.js";

/** Narrow transport port for participant-bound conversation files. */
export interface ConversationAssetsGateway
{
	list(conversationId: string): Promise<readonly ConversationAsset[]>;
	reserve(conversationId: string, request: ReserveConversationAssetUpload): Promise<ConversationAsset>;
	upload(conversationId: string, assetId: string, file: File): Promise<ConversationAsset>;
	remove(conversationId: string, assetId: string): Promise<ConversationAsset>;
}

/** Component-injected conversation file gateway. */
export const CONVERSATION_ASSETS_GATEWAY: InjectionToken<ConversationAssetsGateway> = new InjectionToken<ConversationAssetsGateway>("OC_CONVERSATION_ASSETS_GATEWAY");
