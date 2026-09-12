import { z } from "zod";

import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

import type { ConversationAsset } from "./conversation-assets.types";

/** Accept identifiers without changing the server's stored coordinates. */
const _IDENTIFIER = z.string().refine(function _Nonblank(value) { return value.trim().length > 0; });

/** Validate untrusted API metadata before it can become conversation asset state. */
const _CONVERSATION_ASSET: z.ZodType<ConversationAsset> = z.object({
	id: _IDENTIFIER,
	conversationId: _IDENTIFIER,
	messageId: _IDENTIFIER.nullable(),
	artifactId: _IDENTIFIER.nullable(),
	artifactRevisionId: _IDENTIFIER.nullable(),
	provenance: z.nativeEnum(ConversationAssetProvenance),
	state: z.nativeEnum(ConversationAssetLifecycle),
	displayName: z.string(),
	mediaType: z.string(),
	byteLength: z.number().int().nonnegative().safe().nullable(),
	disposition: z.nativeEnum(ConversationAssetDisposition).nullable(),
	failureCode: z.string().nullable(),
	canRemove: z.boolean(),
	createdAt: z.string(),
}).strict().refine(function _CompleteCoordinates(asset)
{
	return (asset.artifactId === null) === (asset.artifactRevisionId === null);
});

/** Reject incomplete coordinates or invalid lifecycle data without exposing the response in an error. */
export function _ParseConversationAsset(value: unknown): ConversationAsset
{
	const result = _CONVERSATION_ASSET.safeParse(value);
	if (!result.success)
		throw new Error("Conversation file metadata is invalid.");
	return result.data;
}
