import type { TextMessageStartEvent } from "@ag-ui/core";

import type { AgUiStreamState } from "../ag-ui-stream.types";
import { AgUiMessageStatuses } from "./message.types";

/** Create a new streaming message from its start frame. */
export function _StartMessage(state: AgUiStreamState, messageId: string, role: TextMessageStartEvent["role"]): AgUiStreamState
{
	return { ...state, messages: { ...state.messages, [messageId]: { id: messageId, role, text: "", status: AgUiMessageStatuses.Streaming } } };
}

/** Add text to a streaming message; throws when no start frame has created it yet. */
export function _AppendMessage(state: AgUiStreamState, messageId: string, delta: string): AgUiStreamState
{
	const message = state.messages[messageId];
	if (message === undefined || message.status !== AgUiMessageStatuses.Streaming) throw new Error("AG-UI message delta has no active message");
	return { ...state, messages: { ...state.messages, [messageId]: { ...message, text: message.text + delta } } };
}

/** Complete only a message that is currently streaming. */
export function _CompleteMessage(state: AgUiStreamState, messageId: string): AgUiStreamState
{
	const message = state.messages[messageId];
	if (message === undefined || message.status !== AgUiMessageStatuses.Streaming) throw new Error("AG-UI message end has no active message");
	return { ...state, messages: { ...state.messages, [messageId]: { ...message, status: AgUiMessageStatuses.Completed } } };
}

/** Apply the marker that ends a message as failed or cancelled. */
export function _MessageTerminal(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (typeof value !== "object" || value === null) return { ...state, customEvents: [...state.customEvents, name] };
	const marker = value as Record<string, unknown>;
	const messageId = marker["messageId"];
	const eventType = marker["eventType"];
	if (typeof messageId !== "string") return { ...state, customEvents: [...state.customEvents, name] };
	const message = state.messages[messageId];
	if (message === undefined) throw new Error("AG-UI message terminal has no known message");
	if (eventType !== "message.failed" && eventType !== "message.cancelled") throw new Error("AG-UI message terminal is invalid");
	const status = eventType === "message.cancelled" ? AgUiMessageStatuses.Cancelled : AgUiMessageStatuses.Failed;
	return { ...state, messages: { ...state.messages, [messageId]: { ...message, status } }, customEvents: [...state.customEvents, name] };
}
