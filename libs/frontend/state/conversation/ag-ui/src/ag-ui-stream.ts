import { EventType } from "@ag-ui/core";
import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_INTERRUPTS_CLEARED_EVENT, AG_UI_TOOL_FAILURE_EVENT, ___ParseAgUiA2uiEnvelope, type AgUiA2uiEnvelope, type AgUiProjectionEvent, type AgUiToolFailureEnvelope } from "@opencrane/contracts";

import { AgUiMessageStatuses, AgUiRunStatuses, AgUiToolStatuses, type AgUiMessageView, type AgUiStreamRecord, type AgUiStreamState } from "./ag-ui-stream.types.js";

/** Maximum complete progressive history retained for one governed surface. */
const _MAX_MATERIALIZED_A2UI_OPERATIONS = 256;

/** Construct empty state that requires an authoritative stream before displaying content. */
export function __CreateAgUiStreamState(): AgUiStreamState
{
	return { cursor: null, seenCursors: new Map(), runId: null, runStatus: AgUiRunStatuses.Idle, runFailure: null, interrupts: [], messages: {}, tools: {}, surfaces: new Map(), surfaceFingerprints: new Map(), customEvents: [], accessRevoked: false };
}

/** Purge all projected content and reconnect coordinates after proven access loss. */
export function __RevokeAgUiStreamAccess(): AgUiStreamState
{
	return { ...__CreateAgUiStreamState(), accessRevoked: true, customEvents: ["opencrane.access_revoked"] };
}

/** Fold one strict projection record without inferring order from opaque cursor text. */
export function __ReduceAgUiStream(state: AgUiStreamState, record: AgUiStreamRecord): AgUiStreamState
{
	const fingerprint = JSON.stringify(record.data);
	if (record.id !== undefined)
	{
		const prior = state.seenCursors.get(record.id);
		if (prior === fingerprint) return state;
		if (prior !== undefined) throw new Error("durable AG-UI cursor changed payload");
	}
	const reduced = _ReduceEvent(state, record.data);
	if (record.id === undefined || reduced.accessRevoked) return reduced;
	return { ...reduced, cursor: record.id, seenCursors: new Map(reduced.seenCursors).set(record.id, fingerprint) };
}

/** Return the exact durable cursor a reconnecting client must present. */
export function __AgUiResumeCursor(state: AgUiStreamState): string | undefined { return state.cursor ?? undefined; }

/** Apply one exact-pinned event after transport and duplicate validation. */
function _ReduceEvent(state: AgUiStreamState, event: AgUiProjectionEvent): AgUiStreamState
{
	switch (event.type)
	{
		case EventType.RUN_STARTED:
			return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Running, runFailure: null, interrupts: [], accessRevoked: false };
		case EventType.RUN_FINISHED:
			return _FinishRun(state, event);
		case EventType.RUN_ERROR:
			return _FailRun(state, event.message, event.code);
		case EventType.TEXT_MESSAGE_START:
			return { ...state, messages: { ...state.messages, [event.messageId]: { id: event.messageId, role: event.role, text: "", status: AgUiMessageStatuses.Streaming } } };
		case EventType.TEXT_MESSAGE_CONTENT:
			return _AppendMessage(state, event.messageId, event.delta);
		case EventType.TEXT_MESSAGE_END:
			return _CompleteMessage(state, event.messageId);
		case EventType.TOOL_CALL_START:
			return { ...state, tools: { ...state.tools, [event.toolCallId]: { id: event.toolCallId, name: event.toolCallName, arguments: "", status: AgUiToolStatuses.Requested, result: null, failureCode: null, failures: [] } } };
		case EventType.TOOL_CALL_ARGS:
			return _AppendToolArguments(state, event.toolCallId, event.delta);
		case EventType.TOOL_CALL_END:
			return _CompleteTool(state, event.toolCallId);
		case EventType.TOOL_CALL_RESULT:
			return _ResultTool(state, event.toolCallId, event.content);
		case EventType.CUSTOM:
			return _Custom(state, event.name, event.value);
	}
}

/** Preserve a distinct cancelled terminal while retaining only display-safe error details. */
function _FailRun(state: AgUiStreamState, message: string, code: string | undefined): AgUiStreamState
{
	const runStatus = code === "RUN_CANCELLED" ? AgUiRunStatuses.Cancelled : AgUiRunStatuses.Failed;
	return { ...state, runStatus, runFailure: { message, ...(code === undefined ? {} : { code }) }, interrupts: [] };
}

/** Apply a successful or interrupted run terminal without overwriting an error terminal. */
function _FinishRun(state: AgUiStreamState, event: Extract<AgUiProjectionEvent, { readonly type: EventType.RUN_FINISHED }>): AgUiStreamState
{
	if (state.runId !== null && state.runId !== event.runId) throw new Error("AG-UI run terminal does not match the active run");
	if (state.runStatus === AgUiRunStatuses.Failed || state.runStatus === AgUiRunStatuses.Cancelled) throw new Error("AG-UI success cannot overwrite a failed or cancelled run");
	if (event.outcome?.type === "interrupt") return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Interrupted, runFailure: null, interrupts: event.outcome.interrupts };
	return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Succeeded, runFailure: null, interrupts: [] };
}

/** Append message text only after the matching start frame established its role and identity. */
function _AppendMessage(state: AgUiStreamState, messageId: string, delta: string): AgUiStreamState
{
	const message = state.messages[messageId];
	if (message === undefined || message.status !== AgUiMessageStatuses.Streaming) throw new Error("AG-UI message delta has no active message");
	return { ...state, messages: { ...state.messages, [messageId]: { ...message, text: message.text + delta } } };
}

/** Complete only a message that is currently streaming. */
function _CompleteMessage(state: AgUiStreamState, messageId: string): AgUiStreamState
{
	const message = state.messages[messageId];
	if (message === undefined || message.status !== AgUiMessageStatuses.Streaming) throw new Error("AG-UI message end has no active message");
	return { ...state, messages: { ...state.messages, [messageId]: { ...message, status: AgUiMessageStatuses.Completed } } };
}

/** Append tool arguments only after the matching start frame. */
function _AppendToolArguments(state: AgUiStreamState, toolCallId: string, delta: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined || tool.status !== AgUiToolStatuses.Requested) throw new Error("AG-UI tool arguments have no active tool call");
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, arguments: tool.arguments + delta } } };
}

/** Mark one known tool request complete. */
function _CompleteTool(state: AgUiStreamState, toolCallId: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool end has no active tool call");
	const status = tool.failures.length === 0 ? AgUiToolStatuses.Completed : AgUiToolStatuses.Recovered;
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, status } } };
}

/** Attach a display-safe result only to a known tool call. */
function _ResultTool(state: AgUiStreamState, toolCallId: string, content: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool result has no known tool call");
	const status = tool.failures.length === 0 ? AgUiToolStatuses.Completed : AgUiToolStatuses.Recovered;
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, status, result: content } } };
}

/** Apply OpenCrane custom display signals without adopting raw authority payloads. */
function _Custom(state: AgUiStreamState, name: string, value: unknown): AgUiStreamState
{
	if (name === "opencrane.access_revoked") return __RevokeAgUiStreamAccess();
	if (name === AG_UI_INTERRUPTS_CLEARED_EVENT) return { ...state, interrupts: [], customEvents: [...state.customEvents, name] };
	if (name === "opencrane.message_terminal") return _MessageTerminal(state, value, name);
	if (name === AG_UI_TOOL_FAILURE_EVENT) return _ToolFailure(state, value, name);
	if (name === AG_UI_A2UI_ENVELOPE_VERSION) return _A2uiSurface(state, ___ParseAgUiA2uiEnvelope(value), name);
	return { ...state, customEvents: [...state.customEvents, name] };
}

/** Mark one known tool failed while retaining only the server-selected safe classification. */
function _ToolFailure(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsToolFailure(value)) throw new Error("AG-UI tool failure is invalid");
	const tool = state.tools[value.toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool failure has no known tool call");
	const failureCode = value.failureCode ?? null;
	const failed = { ...tool, status: AgUiToolStatuses.Failed, failureCode, failures: [...tool.failures, { code: failureCode }] };
	return { ...state, tools: { ...state.tools, [value.toolCallId]: failed }, customEvents: [...state.customEvents, name] };
}

/** Validate the exact display-safe tool-failure envelope without trusting arbitrary CUSTOM data. */
function _IsToolFailure(value: unknown): value is AgUiToolFailureEnvelope
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (keys.some(function _Unknown(key): boolean { return key !== "eventType" && key !== "toolCallId" && key !== "failureCode"; })) return false;
	return candidate["eventType"] === "tool.failed" && typeof candidate["toolCallId"] === "string" && (candidate["failureCode"] === undefined || typeof candidate["failureCode"] === "string");
}

/** Adopt only an authoritative monotonic surface envelope under its complete stable identity. */
function _A2uiSurface(state: AgUiStreamState, envelope: AgUiA2uiEnvelope, name: string): AgUiStreamState
{
	const identity = _A2uiSurfaceIdentity(envelope);
	const previous = state.surfaces.get(identity);
	const fingerprint = JSON.stringify(envelope);
	const previousFingerprint = state.surfaceFingerprints.get(identity);
	if (previous !== undefined && envelope.sequence < previous.sequence) throw new Error("governed A2UI surface sequence regressed");
	if (previous !== undefined && envelope.sequence > previous.sequence + 1) throw new Error("governed A2UI surface sequence has a gap");
	if (previous !== undefined && envelope.sequence === previous.sequence)
	{
		if (previousFingerprint !== fingerprint) throw new Error("governed A2UI surface sequence changed payload");
		return state;
	}
	const materialized = previous === undefined ? envelope : { ...envelope, operations: [...previous.operations, ...envelope.operations] };
	if (materialized.operations.length > _MAX_MATERIALIZED_A2UI_OPERATIONS) throw new Error("governed A2UI surface history is too large");
	return {
		...state,
		surfaces: new Map(state.surfaces).set(identity, materialized),
		surfaceFingerprints: new Map(state.surfaceFingerprints).set(identity, fingerprint),
		customEvents: [...state.customEvents, name]
	};
}

/** Build one collision-safe key from every stable coordinate that selects a governed surface. */
function _A2uiSurfaceIdentity(envelope: AgUiA2uiEnvelope): string
{
	return JSON.stringify([envelope.conversationId, envelope.runId, envelope.messageId, envelope.surfaceId]);
}

/** Apply the display-safe message terminal marker emitted by the shared projector. */
function _MessageTerminal(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
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
