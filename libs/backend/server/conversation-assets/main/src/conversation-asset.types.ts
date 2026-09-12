import type { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

/** Authenticated participant identity supplied by server composition. */
export interface ConversationAssetCaller
{
	/** Selected silo. */
	readonly siloId: string;
	/** Verified participant subject. */
	readonly subjectId: string;
	/** Stable local Principal that owns artifact authorization boundaries. */
	readonly principalId: string;
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

/** Browser-safe asset view with immutable content identity and no storage or scan authority. */
export interface ConversationAssetView
{
	/** Stable conversation file identifier. */
	readonly id: string;
	/** Conversation that owns the file. */
	readonly conversationId: string;
	/** Immutable message containing this file, or null before submission. */
	readonly messageId: string | null;
	/** Source artifact identity, present only with its revision identity. */
	readonly artifactId: string | null;
	/** Exact source revision used to join the immutable history block. */
	readonly artifactRevisionId: string | null;
	/** Indicates who supplied the file. */
	readonly provenance: ConversationAssetProvenance;
	/** Current upload, processing or availability state. */
	readonly state: ConversationAssetLifecycle;
	/** Participant-visible filename. */
	readonly displayName: string;
	/** Media type checked at upload. */
	readonly mediaType: string;
	/** Exact source length, or null for a removed reservation. */
	readonly byteLength: number | null;
	/** Browser action allowed for the checked media type. */
	readonly disposition: ConversationAssetDisposition | null;
	/** Safe processing failure code, without provider details. */
	readonly failureCode: string | null;
	/** Whether this exact caller may remove the unlinked server reservation now. */
	readonly canRemove: boolean;
	/** Creation time in ISO format. */
	readonly createdAt: string;
}

/** Public denial reasons that are shared across transport and authority layers. */
export enum ConversationAssetDenialReasons
{
	/** No scanner can consume newly quarantined work in this deployment. */
	ScannerUnavailable = "scanner_unavailable",
}

/** Stable public result of a participant asset command. */
export type ConversationAssetResult = { readonly outcome: "accepted" | "idempotent"; readonly asset: ConversationAssetView } | { readonly outcome: "denied"; readonly reason: "invalid_request" | "conversation_unavailable" | "asset_unavailable" | "upload_failed" | "idempotency_conflict" | ConversationAssetDenialReasons.ScannerUnavailable };
