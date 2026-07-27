import type { AgUiProjectionEvent } from "@opencrane/contracts";

import type { AgUiStreamRecord, AgUiStreamState } from "./ag-ui-stream.types.js";

/** Construct an empty state that requires an authoritative stream before it can display content. */
export function __CreateAgUiStreamState(): AgUiStreamState
{
	return { cursor: null, seenCursors: new Set(), runId: null, messages: {}, tools: {}, customEvents: [] };
}

/** Decode one complete AG-UI SSE record, rejecting malformed or non-projection input. */
export function __DecodeAgUiSseRecord(frame: string): AgUiStreamRecord | null
{
	const fields = new Map<string, string>();
	for (const line of frame.replaceAll("\r\n", "\n").split("\n"))
	{
		const separator = line.indexOf(":");
		if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1).trimStart());
	}
	const id = fields.get("id");
	const event = fields.get("event");
	const serialized = fields.get("data");
	if (!id || event !== "ag-ui" || !serialized || /[\r\n]/.test(id)) return null;
	try
	{
		const data = JSON.parse(serialized) as unknown;
		return _IsProjectionEvent(data) ? { id, event: "ag-ui", data } : null;
	}
	catch { return null; }
}

/** Fold one replay record, refusing duplicate cursors without inferring order from opaque identifiers. */
export function __ReduceAgUiStream(state: AgUiStreamState, record: AgUiStreamRecord): AgUiStreamState
{
	if (state.seenCursors.has(record.id)) return state;
	const seenCursors = new Set(state.seenCursors).add(record.id);
	const event = record.data;
	if (event.type === "RUN_STARTED") return { ...state, seenCursors, cursor: record.id, runId: event.runId };
	if (event.type === "TEXT_MESSAGE_START") return { ...state, seenCursors, cursor: record.id, messages: { ...state.messages, [event.messageId]: { id: event.messageId, text: "", complete: false } } };
	if (event.type === "TEXT_MESSAGE_CONTENT")
	{
		const message = state.messages[event.messageId];
		if (!message) return { ...state, seenCursors, cursor: record.id };
		return { ...state, seenCursors, cursor: record.id, messages: { ...state.messages, [event.messageId]: { ...message, text: message.text + event.delta } } };
	}
	if (event.type === "TEXT_MESSAGE_END")
	{
		const message = state.messages[event.messageId];
		return message ? { ...state, seenCursors, cursor: record.id, messages: { ...state.messages, [event.messageId]: { ...message, complete: true } } } : { ...state, seenCursors, cursor: record.id };
	}
	if (event.type === "TOOL_CALL_START") return { ...state, seenCursors, cursor: record.id, tools: { ...state.tools, [event.toolCallId]: { id: event.toolCallId, name: event.toolCallName, complete: false, result: null } } };
	if (event.type === "TOOL_CALL_END")
	{
		const tool = state.tools[event.toolCallId];
		return tool ? { ...state, seenCursors, cursor: record.id, tools: { ...state.tools, [event.toolCallId]: { ...tool, complete: true } } } : { ...state, seenCursors, cursor: record.id };
	}
	if (event.type === "TOOL_CALL_RESULT")
	{
		const tool = state.tools[event.toolCallId];
		return tool ? { ...state, seenCursors, cursor: record.id, tools: { ...state.tools, [event.toolCallId]: { ...tool, complete: true, result: event.content } } } : { ...state, seenCursors, cursor: record.id };
	}
	if (event.type === "CUSTOM") return { ...state, seenCursors, cursor: record.id, customEvents: [...state.customEvents, event.name] };
	return { ...state, seenCursors, cursor: record.id };
}

/** Return the durable cursor a reconnecting client must present to its future authorized reader. */
export function __AgUiResumeCursor(state: AgUiStreamState): string | undefined { return state.cursor ?? undefined; }

/** Validate only the intentionally supported, display-safe event vocabulary. */
function _IsProjectionEvent(value: unknown): value is AgUiProjectionEvent
{
	if (typeof value !== "object" || value === null) return false;
	const event = value as Record<string, unknown>;
	if (event["type"] === "RUN_STARTED" || event["type"] === "RUN_FINISHED") return typeof event["threadId"] === "string" && typeof event["runId"] === "string";
	if (event["type"] === "TEXT_MESSAGE_START") return typeof event["messageId"] === "string" && event["role"] === "assistant";
	if (event["type"] === "TEXT_MESSAGE_CONTENT") return typeof event["messageId"] === "string" && typeof event["delta"] === "string";
	if (event["type"] === "TEXT_MESSAGE_END") return typeof event["messageId"] === "string";
	if (event["type"] === "TOOL_CALL_START") return typeof event["toolCallId"] === "string" && typeof event["toolCallName"] === "string";
	if (event["type"] === "TOOL_CALL_ARGS" || event["type"] === "TOOL_CALL_END") return typeof event["toolCallId"] === "string";
	if (event["type"] === "TOOL_CALL_RESULT") return typeof event["toolCallId"] === "string" && typeof event["content"] === "string";
	return event["type"] === "CUSTOM" && typeof event["name"] === "string" && typeof event["value"] === "object" && event["value"] !== null && typeof (event["value"] as Record<string, unknown>)["eventType"] === "string";
}
