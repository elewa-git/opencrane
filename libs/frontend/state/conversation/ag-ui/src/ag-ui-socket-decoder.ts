import { EventSchemas, EventType } from "@ag-ui/core";

import { AG_UI_A2UI_ENVELOPE_VERSION, ___ParseAgUiA2uiEnvelope, type AgUiProjectionEvent } from "@opencrane/contracts";
import type { AgUiStreamRecord } from "./ag-ui-stream.types";

/**
 * Validates one structured conversation-socket projection frame before the reducer sees it.
 *
 * The server translates its internal SSE serializer to a JSON frame at the transport boundary, so
 * this decoder deliberately accepts that JSON shape rather than reviving an SSE parser in the
 * browser. `null` means the frame is malformed or outside OpenCrane's pinned display-safe AG-UI
 * subset; the socket adapter treats that as a protocol failure rather than reducing untrusted data.
 *
 * Called by: `OpenCraneConversationEventStream` once for each non-heartbeat socket frame.
 *
 * @param value - Parsed JSON received from the conversation WebSocket.
 * @returns A validated projection record, or `null` when the frame is not one this browser owns.
 * @see https://docs.ag-ui.com for the upstream event schemas pinned by `@ag-ui/core`.
 */
export function __DecodeAgUiSocketRecord(value: unknown): AgUiStreamRecord | null
{
	if (typeof value !== "object" || value === null) return null;
	const frame = value as Record<string, unknown>;
	if (frame["type"] !== "conversation.event" || frame["event"] !== "ag-ui") return null;
	const id = frame["id"];
	if (id !== undefined && (typeof id !== "string" || id.length === 0 || /[\r\n]/u.test(id))) return null;
	try { return { ...(id === undefined ? {} : { id }), event: "ag-ui", data: _ProjectionEvent(frame["data"]) }; }
	catch { return null; }
}

/** Parse one event and check it is a type this reducer supports; throws otherwise. */
function _ProjectionEvent(value: unknown): AgUiProjectionEvent
{
	const parsed = EventSchemas.safeParse(value);
	if (!parsed.success || !_IsProjectionEvent(parsed.data)) throw new Error("AG-UI socket data must contain a supported projection event");
	if (parsed.data.type === EventType.CUSTOM && parsed.data.name === AG_UI_A2UI_ENVELOPE_VERSION) ___ParseAgUiA2uiEnvelope(parsed.data.value);
	return parsed.data;
}

/** Narrow the upstream event union to OpenCrane's exact pinned public projection subset. */
function _IsProjectionEvent(event: { readonly type: EventType }): event is AgUiProjectionEvent
{
	return event.type === EventType.RUN_STARTED || event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR || event.type === EventType.TEXT_MESSAGE_START || event.type === EventType.TEXT_MESSAGE_CONTENT || event.type === EventType.TEXT_MESSAGE_END || event.type === EventType.TOOL_CALL_START || event.type === EventType.TOOL_CALL_ARGS || event.type === EventType.TOOL_CALL_END || event.type === EventType.TOOL_CALL_RESULT || event.type === EventType.CUSTOM;
}
