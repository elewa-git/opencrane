import type { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

/** Safe durable file metadata returned for one authorized conversation. */
export interface ConversationAsset
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
	readonly canRemove: boolean;
	readonly canRetry: boolean;
	readonly createdAt: string;
}

/** Retry-stable reservation sent before file bytes. */
export interface ReserveConversationAssetUpload
{
	readonly idempotencyKey: string;
	readonly displayName: string;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly contentAddress: string;
}

/** Local transfer phase before the server owns the durable lifecycle. */
export enum ConversationAssetTransferPhases
{
	Selected = "selected",
	Hashing = "hashing",
	Reserving = "reserving",
	Uploading = "uploading",
	Failed = "failed"
}

/** Display-safe local upload projection retaining no file bytes. */
export interface PendingConversationAssetUpload
{
	readonly idempotencyKey: string;
	readonly displayName: string;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly phase: ConversationAssetTransferPhases;
	readonly canRemove: boolean;
	/** Percentage when the transport can report it, otherwise null for indeterminate progress. */
	readonly uploadProgressPercent: number | null;
	readonly failureCode: "hash_failed" | "reservation_failed" | "upload_failed" | null;
}

/** Complete selection-level rejection before any reservation starts. */
export enum ConversationAssetSelectionFailures
{
	TooManyFiles = "too_many_files",
	TotalTooLarge = "total_too_large",
	UnsupportedMediaType = "unsupported_media_type"
}

/** One typed selection-level rejection. */
export type ConversationAssetSelectionFailure = `${ConversationAssetSelectionFailures}`;
