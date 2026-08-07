import { ___ParseAndValidateJson } from "@opencrane/util";

import type { ConversationReplayCursor } from "./replay-cursor.types.js";

/** Encode one opaque cursor without exposing a database predicate to the caller. */
export function __EncodeConversationReplayCursor(cursor: ConversationReplayCursor): string
{
	return `e.${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

/** Decode one bounded cursor or reject it before it can reach a database query. */
export function __DecodeConversationReplayCursor(value: unknown): ConversationReplayCursor | null
{
	if (typeof value !== "string") return null;
	if (!value.startsWith("e.") || value.length > 512) return null;
	try
	{
		return ___ParseAndValidateJson(Buffer.from(value.slice(2), "base64url").toString("utf8"), "conversation replay cursor", _ReplayCursorFromUnknown);
	}
	catch { return null; }
}

/** Validate exact replay coordinates before they can reach a database query. */
function _ReplayCursorFromUnknown(candidate: unknown): ConversationReplayCursor | null
{
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
	const record = candidate as Record<string, unknown>;
	if (typeof record.acceptedAt !== "string" || Number.isNaN(Date.parse(record.acceptedAt)) || typeof record.runId !== "string" || !record.runId || typeof record.sequence !== "number" || !Number.isSafeInteger(record.sequence) || record.sequence < 1) return null;
	return { acceptedAt: record.acceptedAt, runId: record.runId, sequence: record.sequence };
}
