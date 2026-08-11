import type { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

/** Authenticated participant identity supplied by server composition. */
export interface ConversationAssetCaller
{
	/** Selected silo. */
	readonly siloId: string;
	/** Verified participant subject. */
	readonly subjectId: string;
}

/** Browser request to reserve one participant upload. */
export interface ReserveConversationAssetRequest
{
	/** Caller retry coordinate scoped to the conversation. */
	readonly idempotencyKey: string;
	/** Participant-visible local filename. */
	readonly displayName: string;
	/** Supported declared media type. */
	readonly mediaType: string;
	/** Exact positive byte length. */
	readonly byteLength: number;
	/** Browser-computed immutable SHA-256 address. */
	readonly contentAddress: string;
}

/** Browser-safe asset view with no storage or scan coordinates. */
export interface ConversationAssetView
{
	readonly id: string;
	readonly conversationId: string;
	readonly messageId: string | null;
	readonly provenance: ConversationAssetProvenance;
	readonly state: ConversationAssetLifecycle;
	readonly displayName: string;
	readonly mediaType: string;
	readonly byteLength: number | null;
	readonly disposition: ConversationAssetDisposition | null;
	readonly failureCode: string | null;
	/** Whether this exact caller may remove the unlinked server reservation now. */
	readonly canRemove: boolean;
	/** Whether this exact caller may retry a server-owned terminal operation now. */
	readonly canRetry: boolean;
	readonly createdAt: string;
}

/** Stable public result of a participant asset command. */
export type ConversationAssetResult = { readonly outcome: "accepted" | "idempotent"; readonly asset: ConversationAssetView } | { readonly outcome: "denied"; readonly reason: "invalid_request" | "conversation_unavailable" | "asset_unavailable" | "upload_failed" | "idempotency_conflict" };
