import { EventType } from "@ag-ui/core";
import { RunEventTypes } from "@opencrane/models/agents";
import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_CHILD_RUN_ENVELOPE_VERSION, type AgUiProjectionEvent, type AgUiProjectionSourceEvent, type AgUiSseRecord } from "./ag-ui-projection.types.js";

/** Project one server-authorized canonical event into the small, display-safe AG-UI subset. */
export function __ProjectAgUiEvent(source: AgUiProjectionSourceEvent): AgUiSseRecord
{
	return { ...(source.cursor === undefined ? {} : { id: source.cursor }), event: "ag-ui", data: _Project(source) };
}

/** Select the narrowest standard event whose required display-safe fields are available. */
function _Project(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	switch (source.eventType)
	{
		case RunEventTypes.RunAccepted:
		case RunEventTypes.RunStarted:
			return { type: EventType.RUN_STARTED, threadId: source.conversationId, runId: source.runId };
		case RunEventTypes.RunCompleted:
			return { type: EventType.RUN_FINISHED, threadId: source.conversationId, runId: source.runId, outcome: { type: "success" } };
		case RunEventTypes.RunFailed:
			return { type: EventType.RUN_ERROR, message: _TerminalMessage(source, "Run failed"), ...(source.payload.failureCode === undefined ? {} : { code: source.payload.failureCode }) };
		case RunEventTypes.RunCancelled:
			return { type: EventType.RUN_ERROR, message: _TerminalMessage(source, "Run cancelled"), code: "RUN_CANCELLED" };
		case RunEventTypes.ToolApprovalRequired:
			return source.payload.interrupt === undefined ? _Custom(source) : { type: EventType.RUN_FINISHED, threadId: source.conversationId, runId: source.runId, outcome: { type: "interrupt", interrupts: [source.payload.interrupt] } };
		case RunEventTypes.MessageStarted:
			return typeof source.payload.messageId === "string" ? { type: EventType.TEXT_MESSAGE_START, messageId: source.payload.messageId, role: "assistant" } : _Custom(source);
		case RunEventTypes.MessageDelta:
			return typeof source.payload.messageId === "string" && typeof source.payload.delta === "string" ? { type: EventType.TEXT_MESSAGE_CONTENT, messageId: source.payload.messageId, delta: source.payload.delta } : _Custom(source);
		case RunEventTypes.MessageCompleted:
			return typeof source.payload.messageId === "string" ? { type: EventType.TEXT_MESSAGE_END, messageId: source.payload.messageId } : _Custom(source);
		case RunEventTypes.ToolRequested:
			return typeof source.payload.toolCallId === "string" && typeof source.payload.toolCallName === "string" ? { type: EventType.TOOL_CALL_START, toolCallId: source.payload.toolCallId, toolCallName: source.payload.toolCallName } : _Custom(source);
		case RunEventTypes.ToolCompleted:
			if (typeof source.payload.toolCallId !== "string") return _Custom(source);
			return { type: EventType.TOOL_CALL_END, toolCallId: source.payload.toolCallId };
		default:
			if (source.payload.a2ui !== undefined) return { type: EventType.CUSTOM, name: AG_UI_A2UI_ENVELOPE_VERSION, value: source.payload.a2ui };
			if (source.payload.childRun !== undefined) return { type: EventType.CUSTOM, name: AG_UI_CHILD_RUN_ENVELOPE_VERSION, value: source.payload.childRun };
			return _Custom(source);
	}
}

/** Keep terminal details useful while limiting them to the server-selected reason vocabulary. */
function _TerminalMessage(source: AgUiProjectionSourceEvent, fallback: string): string
{
	return source.payload.terminalReason === undefined ? fallback : `${fallback}: ${source.payload.terminalReason}`;
}

/** Keep unsupported, incomplete, and future source events observable without forwarding their payload. */
function _Custom(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	return { type: EventType.CUSTOM, name: `opencrane.${source.eventType.replaceAll(".", "_")}`, value: { eventType: source.eventType } };
}
