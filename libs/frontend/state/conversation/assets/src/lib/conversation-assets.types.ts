import type { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

/** Safe durable file metadata returned for one authorized conversation. */
export interface ConversationAsset
{
	readonly id: string;
	readonly conversationId: string;
	readonly messageId: string | null;
	/** Artifact record referenced by a bound history block, or null before publication. */
	readonly artifactId: string | null;
	/** Published revision referenced by a bound history block, or null before publication. */
	readonly artifactRevisionId: string | null;
	readonly provenance: ConversationAssetProvenance;
	readonly state: ConversationAssetLifecycle;
	readonly displayName: string;
	readonly mediaType: string;
	readonly byteLength: number | null;
	readonly disposition: ConversationAssetDisposition | null;
	readonly failureCode: string | null;
	readonly canRemove: boolean;
	readonly createdAt: string;
}

/**
 * Local state of one authorized asset-content read.
 *
 * This state is held only by the component-scoped content store. It is neither persisted nor sent
 * to the server, and changing a value does not change the asset's durable lifecycle.
 */
export enum ConversationAssetContentCommandStates
{
	/** No content read is running and the last read did not leave visible failure feedback. */
	Idle = "idle",
	/** The participant admitted one read and a duplicate read for the same asset is refused. */
	Loading = "loading",
	/** The current asset read or browser action failed and an explicit retry is available. */
	Failed = "failed"
}

/** Short-lived bytes returned after the current asset metadata still matches the authorized read. */
export interface ConversationAssetContent
{
	readonly blob: Blob;
	readonly displayName: string;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly disposition: ConversationAssetDisposition;
}

/** Byte-relevant Ready asset fields captured before one content transport begins. */
export interface ConversationAssetContentAdmission
{
	readonly conversationId: string;
	readonly scopeGeneration: number;
	readonly assetId: string;
	readonly displayName: string;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly disposition: ConversationAssetDisposition;
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
