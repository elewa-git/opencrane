import type { Request } from "express";

import type { ConversationAssetCaller, ConversationAssetResult, ConversationAssetView, ReserveConversationAssetRequest } from "./conversation-asset.types";
import type { ConversationAssetContentAuthority } from "./conversation-asset-content.types";

/** Public participant asset authority consumed by the router. */
export interface ConversationAssetAuthority extends ConversationAssetContentAuthority
{
	reserveUpload(caller: ConversationAssetCaller, conversationId: string, request: ReserveConversationAssetRequest): Promise<ConversationAssetResult>;
	upload(caller: ConversationAssetCaller, conversationId: string, assetId: string, bytes: AsyncIterable<Uint8Array>): Promise<ConversationAssetResult>;
	remove(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetResult>;
	list(caller: ConversationAssetCaller, conversationId: string): Promise<readonly ConversationAssetView[]>;
}

/** Dependencies for the authenticated participant asset router. */
export interface ConversationAssetRouterDependencies
{
	readonly resolveCaller: (request: Request) => ConversationAssetCaller | null;
	readonly authority: ConversationAssetAuthority;
	readonly logger: { error(value: object, message: string): void };
}
