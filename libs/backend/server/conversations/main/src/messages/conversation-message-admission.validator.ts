import { z } from "zod";

import { ConversationMessageActivations, type ConversationMessageCommand } from "./self-conversation-history.types";

/** Maximum attachments accepted with one participant message. */
export const _MAXIMUM_CONVERSATION_MESSAGE_ASSETS = 10;
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const _ASSET_ID_PATTERN = /^[\x21-\x7e]{1,128}$/;
const _AssetIdsSchema = z.array(z.string().regex(_ASSET_ID_PATTERN)).max(_MAXIMUM_CONVERSATION_MESSAGE_ASSETS).refine(function _Unique(assetIds) { return new Set(assetIds).size === assetIds.length; }).transform(_AsciiSorted);

// Browser JSON is untrusted; this schema owns the complete participant message body.
const _ConversationMessageCommandSchema: z.ZodType<ConversationMessageCommand, z.ZodTypeDef, unknown> = z.object({
	idempotencyKey: z.string().regex(_UUID_PATTERN),
	text: z.string().refine(function _BoundedText(text) { return Buffer.byteLength(text, "utf8") <= 65_536; }),
	assetIds: _AssetIdsSchema,
	activation: z.nativeEnum(ConversationMessageActivations),
}).strict().refine(function _HasContent(command) { return command.text.length > 0 || command.assetIds.length > 0; });

/** Parses one browser message body and removes unknown or malformed values. */
export function _ParseConversationMessageCommand(value: unknown): ConversationMessageCommand | null
{
	const parsed = _ConversationMessageCommandSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Validates, deduplicates and ASCII-sorts one internal message attachment set. */
export function _CanonicalConversationMessageAssetIds(value: unknown): readonly string[] | null
{
	const parsed = _AssetIdsSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Orders printable ASCII identifiers without locale-specific collation. */
function _AsciiSorted(assetIds: readonly string[]): readonly string[]
{
	return [...assetIds].sort(function _Ascii(left, right)
	{
		if (left < right)
			return -1;
		if (left > right)
			return 1;
		return 0;
	});
}
