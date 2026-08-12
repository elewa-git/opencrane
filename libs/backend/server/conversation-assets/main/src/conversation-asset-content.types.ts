import type { ConversationAssetDisposition } from "@opencrane/models/conversation-assets";

import type { ConversationAssetCaller } from "./conversation-asset.types.js";

/** Exact published revision selected only after current participant authorization succeeds. */
export interface ConversationAssetReadTarget
{
	/** Silo independently loaded from the authenticated participant and conversation. */
	readonly siloId: string;
	/** Logical artifact that owns the checked bytes. */
	readonly artifactId: string;
	/** Immutable published revision selected by the ready conversation asset. */
	readonly artifactRevisionId: string;
	/** Participant-visible filename used only in the safe response disposition. */
	readonly displayName: string;
	/** Exact published media type checked against the private byte service. */
	readonly mediaType: string;
	/** Exact published byte count checked against the private byte service. */
	readonly byteLength: number;
	/** Browser presentation allowed by the shared conversation-file policy. */
	readonly disposition: ConversationAssetDisposition;
}

/** Private broker that consumes storage authority and exposes only the selected byte stream. */
export interface ConversationAssetContentBroker
{
	/** Opens the exact published target or returns null when its publication authority changed. */
	open(target: ConversationAssetReadTarget): Promise<AsyncIterable<Uint8Array> | null>;
}

/** Browser-safe content response with no artifact coordinates or lease material. */
export interface ConversationAssetContent
{
	/** Participant-visible filename for Content-Disposition. */
	readonly displayName: string;
	/** Exact checked response media type. */
	readonly mediaType: string;
	/** Exact checked response byte count. */
	readonly byteLength: number;
	/** Whether the browser may render inline or must download. */
	readonly disposition: ConversationAssetDisposition;
	/** Exact published bytes streamed without a storage redirect. */
	readonly bytes: AsyncIterable<Uint8Array>;
}

/** Participant-authorized read operation consumed by the public conversation asset router. */
export interface ConversationAssetContentAuthority
{
	/** Reloads access and ready state before brokering one exact asset response. */
	read(caller: ConversationAssetCaller, conversationId: string, assetId: string): Promise<ConversationAssetContent | null>;
}
