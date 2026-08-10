import type { AgUiPublicEventPayload } from "@opencrane/contracts";

import type { ConversationReplayEventRow, ConversationReplayProjectionResult } from "./replay-projection.types.js";

/** Redact one canonical timeline row into only the fields the AG-UI projection contract allows. */
export function __ProjectConversationReplayEvent(row: ConversationReplayEventRow): ConversationReplayProjectionResult
{
	if (!row.cursor || !row.conversationId || !row.runId || !/^[1-9]\d*$/u.test(row.position) || !row.type || Number.isNaN(Date.parse(row.occurredAt))) return null;
	return { cursor: row.cursor, conversationId: row.conversationId, runId: row.runId, position: row.position, eventType: row.type, occurredAt: row.occurredAt, payload: _SafePayload(row.type, row.payload) };
}

/** Select only schema-free display fields needed by known projected event types. */
function _SafePayload(type: string, payload: Readonly<Record<string, unknown>>): AgUiPublicEventPayload
{
	if (type === "message.started" || type === "message.completed") return _Strings(payload, ["messageId"]);
	if (type === "message.delta") return _Strings(payload, ["messageId", "delta"]);
	if (type === "tool.requested") return _Strings(payload, ["toolCallId", "toolCallName"]);
	if (type === "tool.completed") return _Strings(payload, ["toolCallId"]);
	return {};
}

/** Copy named string values and drop every other canonical payload field. */
function _Strings(payload: Readonly<Record<string, unknown>>, names: readonly (keyof AgUiPublicEventPayload)[]): AgUiPublicEventPayload
{
	const result: Record<string, string> = {};
	for (const name of names)
	{
		const value = payload[name];
		if (typeof value === "string") result[name] = value;
	}
	return result;
}
