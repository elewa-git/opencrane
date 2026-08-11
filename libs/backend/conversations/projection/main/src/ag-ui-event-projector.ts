import { EventType } from "@ag-ui/core";
import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_CHILD_RUN_ENVELOPE_VERSION, AG_UI_TOOL_FAILURE_EVENT, AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, RunEventTypes, type AgUiProjectionEvent, type AgUiProjectionSourceEvent, type AgUiToolFailureEnvelope, type AgUiToolRecoveryRequiredEnvelope } from "@opencrane/contracts";

/**
 * Turns one display-safe conversation event into the AG-UI events the client receives, in order.
 *
 * A stored message can become a start event, a text event and an end event. Run events use the most
 * specific AG-UI event whose required fields are present. Unsupported events remain visible as
 * custom events without copying their source payload.
 *
 * Called by: `__StreamConversationProjection`.
 *
 * @param source Display-safe source event produced by `__ProjectConversationEvent`.
 * @returns One or more ordered events accepted by the pinned `@ag-ui/core` 0.0.57 schemas.
 * @see https://www.npmjs.com/package/@ag-ui/core/v/0.0.57
 */
export function __ProjectAgUiEvents(source: AgUiProjectionSourceEvent): readonly AgUiProjectionEvent[]
{
	if (source.eventType === "conversation.message") return _Message(source);
	return [_Project(source)];
}

/** Expand one stored message into the standard TEXT_MESSAGE_START / CONTENT / END events. */
function _Message(source: AgUiProjectionSourceEvent): readonly AgUiProjectionEvent[]
{
	const payload = source.payload;
	if (payload.messageId === undefined || payload.messageRole === undefined || payload.messageState === undefined) return [_Custom(source)];
	if (payload.messageRole === "tool") return [_Custom(source)];
	const events: AgUiProjectionEvent[] = [{ type: EventType.TEXT_MESSAGE_START, messageId: payload.messageId, role: payload.messageRole }];
	if (payload.messageText !== undefined && payload.messageText.length > 0) events.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: payload.messageId, delta: payload.messageText });
	if (payload.messageState === "completed") events.push({ type: EventType.TEXT_MESSAGE_END, messageId: payload.messageId });
	if (payload.messageState === "failed" || payload.messageState === "cancelled") events.push({ type: EventType.CUSTOM, name: "opencrane.message_terminal", value: { eventType: `message.${payload.messageState}`, messageId: payload.messageId } });
	return events;
}

/** Pick the most specific standard event whose required fields are present; otherwise fall back to a CUSTOM event. */
function _Project(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	switch (source.eventType)
	{
		case RunEventTypes.RunAccepted:
		case RunEventTypes.RunStarted:
			return source.runId === undefined ? _Custom(source) : { type: EventType.RUN_STARTED, threadId: source.conversationId, runId: source.runId };
		case RunEventTypes.RunCompleted:
			return source.runId === undefined ? _Custom(source) : { type: EventType.RUN_FINISHED, threadId: source.conversationId, runId: source.runId, outcome: { type: "success" } };
		case RunEventTypes.RunFailed:
			return { type: EventType.RUN_ERROR, message: _TerminalMessage(source, "Run failed"), ...(source.payload.failureCode === undefined ? {} : { code: source.payload.failureCode }) };
		case RunEventTypes.RunCancelled:
			return { type: EventType.RUN_ERROR, message: _TerminalMessage(source, "Run cancelled"), code: "RUN_CANCELLED" };
		case RunEventTypes.ElicitationRequested:
			return source.payload.interrupt === undefined || source.runId === undefined ? _Custom(source) : { type: EventType.RUN_FINISHED, threadId: source.conversationId, runId: source.runId, outcome: { type: "interrupt", interrupts: [source.payload.interrupt] } };
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
		case RunEventTypes.ToolFailed:
			return _ToolFailure(source);
		case RunEventTypes.ToolRecoveryRequired:
			return _ToolRecoveryRequired(source);
		default:
			if (source.payload.a2ui !== undefined) return { type: EventType.CUSTOM, name: AG_UI_A2UI_ENVELOPE_VERSION, value: source.payload.a2ui };
			if (source.payload.childRun !== undefined) return { type: EventType.CUSTOM, name: AG_UI_CHILD_RUN_ENVELOPE_VERSION, value: source.payload.childRun };
			return _Custom(source);
	}
}

/** Emit the server-redacted recovery payload. A row missing `runId` or `toolRecovery` becomes a CUSTOM event with no payload. */
function _ToolRecoveryRequired(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	if (source.runId === undefined || source.payload.toolRecovery === undefined) return _Custom(source);
	const value: AgUiToolRecoveryRequiredEnvelope = { ...source.payload.toolRecovery, runId: source.runId, occurredAt: source.occurredAt };
	return { type: EventType.CUSTOM, name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value };
}

/** Keep the tool-call id and failure code, and nothing from the provider's own error. */
function _ToolFailure(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	if (typeof source.payload.toolCallId !== "string" || source.payload.toolFailure === undefined) return _Custom(source);
	const value: AgUiToolFailureEnvelope = { eventType: RunEventTypes.ToolFailed, toolCallId: source.payload.toolCallId, ...source.payload.toolFailure, ...(source.payload.failureCode === undefined ? {} : { failureCode: source.payload.failureCode }) };
	return { type: EventType.CUSTOM, name: AG_UI_TOOL_FAILURE_EVENT, value };
}

/** Append the server-chosen `terminalReason` to the fallback message, if there is one. */
function _TerminalMessage(source: AgUiProjectionSourceEvent, fallback: string): string
{
	return source.payload.terminalReason === undefined ? fallback : `${fallback}: ${source.payload.terminalReason}`;
}

/** Emit a CUSTOM event naming the source event type, so unsupported, incomplete, and future events stay visible without their payload leaking. */
function _Custom(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	return { type: EventType.CUSTOM, name: `opencrane.${source.eventType.replaceAll(".", "_")}`, value: { eventType: source.eventType } };
}
