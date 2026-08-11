import type { ConversationAssetDisposition, ConversationAssetProvenance } from "@opencrane/state/conversation/assets";

/** Finite visible file states, including non-disclosing reference failures. */
export enum ConversationAssetPresentationStates
{
	Selected = "selected",
	Creating = "creating",
	Uploading = "uploading",
	Processing = "processing",
	Ready = "ready",
	Failed = "failed",
	Inaccessible = "inaccessible",
	Expired = "expired",
	Removed = "removed",
	Unavailable = "unavailable"
}

/** Typed user intent emitted by file presentation controls. */
export enum ConversationAssetActionKinds
{
	Retry = "retry",
	Remove = "remove",
	Preview = "preview",
	Download = "download",
	Open = "open",
	FocusMessage = "focus_message"
}

/** One complete display-safe file presentation. */
export interface ConversationAssetPresentation
{
	readonly id: string;
	readonly messageId: string | null;
	readonly provenance: ConversationAssetProvenance;
	readonly displayName: string;
	readonly mediaType: string;
	readonly byteLength: number | null;
	readonly disposition: ConversationAssetDisposition | null;
	readonly state: ConversationAssetPresentationStates;
	readonly detail: string;
	readonly canRetry: boolean;
	readonly canRemove: boolean;
}

/** Parent-owned action request carrying only the displayed stable coordinate. */
export interface ConversationAssetActionIntent
{
	readonly kind: ConversationAssetActionKinds;
	readonly assetId: string;
}
