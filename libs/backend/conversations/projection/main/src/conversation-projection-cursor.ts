import { ___ParseAndValidateJson } from "@opencrane/util";
import { ___ConversationReplayCursorSchema, type ConversationReplayCursor } from "@opencrane/contracts";

/**
 * Encodes one canonical timeline position as an opaque browser resume cursor.
 *
 * Called by: the Prisma conversation reader and `__StreamConversationProjection`.
 *
 * @param cursor Trusted conversation, position and optional subframe coordinates.
 * @returns A bounded base64url cursor prefixed with `c.`.
 */
export function __EncodeConversationProjectionCursor(cursor: ConversationReplayCursor): string
{
	return `c.${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

/**
 * Decodes a bounded resume cursor before it can influence a database query.
 *
 * Invalid, oversized or schema-incomplete values return `null`; callers must reject a supplied
 * cursor when this happens.
 *
 * Called by: the internal and signed-in conversation stream routes.
 *
 * @param value Untrusted query-string or `Last-Event-ID` value.
 * @returns Exact replay coordinates, or `null` when validation fails.
 */
export function __DecodeConversationProjectionCursor(value: unknown): ConversationReplayCursor | null
{
	if (typeof value !== "string") return null;
	if (!value.startsWith("c.") || value.length > 512) return null;
	try
	{
		return ___ParseAndValidateJson(Buffer.from(value.slice(2), "base64url").toString("utf8"), "conversation projection cursor", _ProjectionCursorFromUnknown);
	}
	catch { return null; }
}

/** Validate exact replay coordinates before they can reach a database query. */
function _ProjectionCursorFromUnknown(candidate: unknown): ConversationReplayCursor | null
{
	const parsed = ___ConversationReplayCursorSchema.safeParse(candidate);
	return parsed.success ? parsed.data : null;
}
