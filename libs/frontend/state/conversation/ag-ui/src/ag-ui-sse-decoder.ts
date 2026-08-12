import { EventSchemas, EventType } from "@ag-ui/core";

import { AG_UI_A2UI_ENVELOPE_VERSION, ___ParseAgUiA2uiEnvelope, type AgUiProjectionEvent } from "@opencrane/contracts";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { AgUiStreamRecord } from "./ag-ui-stream.types.js";

/**
 * Decodes one complete SSE frame into a record, or returns null to skip it.
 *
 * Returns null — never throws — for anything this stream does not handle: a malformed field line,
 * more than one `id`, an `id` containing a newline, a missing or non-"ag-ui" `event`, no `data`, or
 * data that is not a supported projection event. The caller should ignore a null and keep reading;
 * a null is not a reason to fail the stream.
 *
 * Called by: OpenCraneConversationEventStream (state/conversation/adapter), once per frame split
 * out of the response body.
 *
 * @param frame - One complete SSE frame, LF- or CRLF-delimited, without its trailing blank line.
 * @returns The decoded record, or `null` meaning skip this frame.
 * @see AG-UI protocol docs — the event schemas validated here (@ag-ui/core 0.0.57):
 *   https://docs.ag-ui.com
 * @see WHATWG HTML server-sent events — the frame grammar being parsed (field lines, `id`,
 *   `event`, `data`, comment lines beginning `:`)
 */
export function __DecodeAgUiSseRecord(frame: string): AgUiStreamRecord | null
{
	const fields = new Map<string, string[]>();
	for (const line of frame.replaceAll("\r\n", "\n").split("\n"))
	{
		if (line.length === 0 || line.startsWith(":")) continue;
		const separator = line.indexOf(":");
		if (separator <= 0) return null;
		const name = line.slice(0, separator);
		const values = fields.get(name) ?? [];
		values.push(line.slice(separator + 1).trimStart());
		fields.set(name, values);
	}
	const ids = fields.get("id") ?? [];
	const events = fields.get("event") ?? [];
	const dataFields = fields.get("data") ?? [];
	if (ids.length > 1 || events.length !== 1 || events[0] !== "ag-ui" || dataFields.length === 0) return null;
	const id = ids[0];
	if (id !== undefined && (id.length === 0 || /[\r\n]/u.test(id))) return null;
	try
	{
		const data = ___ParseAndValidateJson(dataFields.join("\n"), "AG-UI SSE data", _ProjectionEvent);
		return { ...(id === undefined ? {} : { id }), event: "ag-ui", data };
	}
	catch { return null; }
}

/** Parse one event and check it is a type this reducer supports; throws otherwise. */
function _ProjectionEvent(value: unknown): AgUiProjectionEvent
{
	const parsed = EventSchemas.safeParse(value);
	if (!parsed.success || !_IsProjectionEvent(parsed.data)) throw new Error("AG-UI SSE data must contain a supported projection event");
	if (parsed.data.type === EventType.CUSTOM && parsed.data.name === AG_UI_A2UI_ENVELOPE_VERSION) ___ParseAgUiA2uiEnvelope(parsed.data.value);
	return parsed.data;
}

/** Narrow the upstream event union to OpenCrane's exact pinned public projection subset. */
function _IsProjectionEvent(event: { readonly type: EventType }): event is AgUiProjectionEvent
{
	return event.type === EventType.RUN_STARTED || event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR || event.type === EventType.TEXT_MESSAGE_START || event.type === EventType.TEXT_MESSAGE_CONTENT || event.type === EventType.TEXT_MESSAGE_END || event.type === EventType.TOOL_CALL_START || event.type === EventType.TOOL_CALL_ARGS || event.type === EventType.TOOL_CALL_END || event.type === EventType.TOOL_CALL_RESULT || event.type === EventType.CUSTOM;
}
