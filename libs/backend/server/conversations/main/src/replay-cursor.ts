import { ___ParseAndValidateJson } from "@opencrane/util";
import { ___ConversationReplayCursorSchema, type ConversationReplayCursor } from "@opencrane/models/conversations";

/** Encode one opaque canonical-timeline cursor without exposing its database predicate. */
export function __EncodeConversationReplayCursor(cursor: ConversationReplayCursor): string
{
	return `c.${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

/** Decode one bounded cursor or reject it before it can reach a database query. */
export function __DecodeConversationReplayCursor(value: unknown): ConversationReplayCursor | null
{
	if (typeof value !== "string") return null;
	if (!value.startsWith("c.") || value.length > 512) return null;
	try
	{
		return ___ParseAndValidateJson(Buffer.from(value.slice(2), "base64url").toString("utf8"), "conversation replay cursor", _ReplayCursorFromUnknown);
	}
	catch { return null; }
}

/** Validate exact replay coordinates before they can reach a database query. */
function _ReplayCursorFromUnknown(candidate: unknown): ConversationReplayCursor | null
{
	const parsed = ___ConversationReplayCursorSchema.safeParse(candidate);
	return parsed.success ? parsed.data : null;
}
