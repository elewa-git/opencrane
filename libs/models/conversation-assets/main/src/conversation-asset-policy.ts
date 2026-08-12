import { ConversationAssetDisposition } from "./conversation-asset.types.js";
import type { ConversationAssetBatchDecision, ConversationAssetBatchItem } from "./conversation-asset.types.js";

/** Maximum files admitted by one message. */
export const ___CONVERSATION_ASSET_MAX_FILES = 10;

/** Maximum combined bytes admitted by one message. */
export const ___CONVERSATION_ASSET_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const _PREVIEW_MEDIA_TYPES = new Set<string>([
	"application/pdf",
	"audio/mpeg",
	"image/png"
]);

const _DOWNLOAD_MEDIA_TYPES = new Set<string>([
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/zip"
]);

/** Returns the browser presentation allowed for a supported media type. */
export function ___ConversationAssetMediaDisposition(mediaType: string): ConversationAssetDisposition | null
{
	if (_PREVIEW_MEDIA_TYPES.has(mediaType))
	{
		return ConversationAssetDisposition.Preview;
	}

	if (_DOWNLOAD_MEDIA_TYPES.has(mediaType))
	{
		return ConversationAssetDisposition.Download;
	}

	return null;
}

/** Returns whether a media type may enter the conversation-asset pipeline. */
export function ___IsSupportedConversationAssetMediaType(mediaType: string): boolean
{
	return ___ConversationAssetMediaDisposition(mediaType) !== null;
}

/** Applies the complete per-message file-count, byte, and media policy. */
export function ___DecideConversationAssetBatch(items: readonly ConversationAssetBatchItem[]): ConversationAssetBatchDecision
{
	if (items.length > ___CONVERSATION_ASSET_MAX_FILES)
	{
		return { accepted: false, failureCode: "too_many_files" };
	}

	if (items.some((item) => !___IsSupportedConversationAssetMediaType(item.mediaType)))
	{
		return { accepted: false, failureCode: "unsupported_media_type" };
	}

	const totalBytes = items.reduce((sum, item) => sum + item.byteLength, 0);
	if (!Number.isSafeInteger(totalBytes) || totalBytes > ___CONVERSATION_ASSET_MAX_TOTAL_BYTES)
	{
		return { accepted: false, failureCode: "total_too_large" };
	}

	return { accepted: true, failureCode: null };
}
