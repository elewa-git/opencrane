/** Durable origin of bytes exposed in a conversation. */
export enum ConversationAssetProvenance
{
	/** Bytes selected and uploaded by a conversation participant. */
	ParticipantUpload = "participant_upload",
	/** Bytes created by an admitted agent run. */
	AgentOutput = "agent_output"
}

/** Browser-safe lifecycle of a conversation asset. */
export enum ConversationAssetLifecycle
{
	/** An upload is still transferring bytes. */
	Uploading = "uploading",
	/** Bytes are quarantined while safety checks run. */
	Processing = "processing",
	/** Checked bytes may be previewed or downloaded. */
	Ready = "ready",
	/** The upload or safety check failed. */
	Failed = "failed",
	/** The durable asset was removed from the conversation. */
	Removed = "removed"
}

/** Browser presentation allowed for a checked media type. */
export enum ConversationAssetDisposition
{
	/** Safe local rendering is supported. */
	Preview = "preview",
	/** The browser may only offer an authorised download. */
	Download = "download"
}

/** One file proposed for a single message. */
export interface ConversationAssetBatchItem
{
	/** Exact byte length selected by the participant. */
	readonly byteLength: number;
	/** Declared IANA media type. */
	readonly mediaType: string;
}

/** Validation result for one message attachment batch. */
export interface ConversationAssetBatchDecision
{
	/** Whether the complete batch may be admitted. */
	readonly accepted: boolean;
	/** Stable public failure code, or null when accepted. */
	readonly failureCode: "too_many_files" | "total_too_large" | "unsupported_media_type" | null;
}
