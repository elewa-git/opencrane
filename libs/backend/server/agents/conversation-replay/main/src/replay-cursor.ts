import type { ConversationReplayCursor } from "./replay-cursor.types.js";

/** Encode one opaque cursor without exposing a database predicate to the caller. */
export function __EncodeConversationReplayCursor(cursor: ConversationReplayCursor): string
{
	return `e.${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
}

/** Decode one bounded cursor or reject it before it can reach a database query. */
export function __DecodeConversationReplayCursor(value: string | undefined): ConversationReplayCursor | null
{
	if (value === undefined) return null;
	if (!value.startsWith("e.") || value.length > 512) return null;
	try
	{
		const candidate = JSON.parse(Buffer.from(value.slice(2), "base64url").toString("utf8")) as unknown;
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
		const record = candidate as Record<string, unknown>;
		if (typeof record.acceptedAt !== "string" || Number.isNaN(Date.parse(record.acceptedAt)) || typeof record.runId !== "string" || !record.runId || typeof record.sequence !== "number" || !Number.isSafeInteger(record.sequence) || record.sequence < 1) return null;
		return { acceptedAt: record.acceptedAt, runId: record.runId, sequence: record.sequence };
	}
	catch { return null; }
}
