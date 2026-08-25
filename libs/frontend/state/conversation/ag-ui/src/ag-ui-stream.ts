import { EventType } from "@ag-ui/core";
import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT, AG_UI_INTERRUPTS_CLEARED_EVENT, AG_UI_TOOL_FAILURE_EVENT, AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, ___ParseAgUiA2uiEnvelope, type AgUiProjectionEvent } from "@opencrane/contracts";

import { _A2uiSurface } from "./a2ui-surface/a2ui-surface-reducer";
import { _AgentThreadParentDelivery } from "./agent-thread-delivery/agent-thread-delivery-reducer";
import type { AgUiStreamRecord, AgUiStreamState } from "./ag-ui-stream.types";
import { _AppendMessage, _CompleteMessage, _MessageTerminal, _StartMessage } from "./message/message-reducer";
import { _FailRun, _FinishRun, _StartRun } from "./run/run-reducer";
import { AgUiRunStatuses } from "./run/run.types";
import { _AppendToolArguments, _CompleteTool, _ResultTool, _StartTool, _ToolFailure, _ToolRecoveryRequired } from "./tool/tool-reducer";

/**
 * Builds the starting state for a conversation stream: no run, no messages, no cursor.
 *
 * Nothing is displayed until the server stream sends events — this state deliberately invents no
 * placeholder content. Call it when opening a stream for the first time; to resume an existing
 * one, pass the previous state instead so its cursor is reused.
 *
 * Called by: OpenCraneConversationEventStream (state/conversation/adapter), as the fallback when
 * the caller supplies no `initialState`.
 *
 * @returns Empty stream state, safe to reduce records into.
 */
export function __CreateAgUiStreamState(): AgUiStreamState
{
	return { cursor: null, seenCursors: new Map(), runId: null, runStatus: AgUiRunStatuses.Idle, runFailure: null, runRecovery: null, interrupts: [], messages: {}, tools: {}, surfaces: new Map(), surfaceFingerprints: new Map(), customEvents: [], agentThreadParentDeliveries: {}, accessRevoked: false };
}

/**
 * Throws away everything in the stream state once the user has lost access to the conversation.
 *
 * Clears the messages, tools, surfaces and interrupts AND the reconnect cursors, so nothing can be
 * shown from memory and no reconnect can resume the old position. The returned state has
 * `accessRevoked` set and carries the single custom event "opencrane.access_revoked", which is how
 * the UI knows to show a revoked state rather than an error.
 *
 * Called by: OpenCraneConversationEventStream (state/conversation/adapter) after an access-denied
 * socket close, and reached from within the reducer when the server sends the
 * "opencrane.access_revoked" custom event.
 *
 * @returns Empty state marked as revoked. Do not keep reducing into the previous state after this.
 */
export function __RevokeAgUiStreamAccess(): AgUiStreamState
{
	return { ...__CreateAgUiStreamState(), accessRevoked: true, customEvents: ["opencrane.access_revoked"] };
}

/**
 * Folds one decoded socket projection record into the stream state, returning new state.
 *
 * Order comes only from the records arriving in order — the cursor is an opaque server string and
 * is never parsed or compared to work out what came first.
 *
 * Two things a caller must handle. A record whose cursor has been seen before with the SAME
 * payload is a harmless duplicate and the previous state is returned unchanged, so replaying after
 * a reconnect is safe. A record whose cursor has been seen before with a DIFFERENT payload, or a
 * record that contradicts the run (a success after a failure, a message delta with no start frame,
 * a surface sequence that goes backwards or skips) makes this THROW. That is not a transport
 * error to retry: the stream cannot be trusted, so the caller should fail it and surface the last
 * accepted state rather than reconnecting into the same contradiction.
 *
 * Called by: OpenCraneConversationEventStream (state/conversation/adapter), once per accepted
 * frame.
 *
 * @param state - The state so far; never mutated.
 * @param record - One decoded record from {@link __DecodeAgUiSocketRecord}.
 * @returns New state with the record applied; or `state` itself, meaning the record was an exact
 *   duplicate and nothing changed. Records with a cursor advance `cursor`; records without one are
 *   temporary overlays and leave it alone.
 * @throws Error when the stream contradicts itself or a cursor is reused with a different payload.
 * @see AG-UI protocol docs — the event types handled in _ReduceEvent: https://docs.ag-ui.com
 */
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

/**
 * Returns the cursor a reconnecting socket must send, or undefined to start from the beginning.
 *
 * Undefined is normal, not an error: it means no record with a cursor has been accepted yet, so
 * there is nothing to resume from. The caller sends the value as the socket `cursor` query
 * parameter.
 *
 * Called by: OpenCraneConversationEventStream (state/conversation/adapter) before each socket.
 *
 * @param state - Current stream state.
 * @returns The cursor to resume from, or `undefined` meaning start the socket projection from its beginning.
 */
export function __AgUiResumeCursor(state: AgUiStreamState): string | undefined { return state.cursor ?? undefined; }

/** Apply one event; the caller has already checked the transport framing and rejected duplicates. */
function _ReduceEvent(state: AgUiStreamState, event: AgUiProjectionEvent): AgUiStreamState
{
	switch (event.type)
	{
		case EventType.RUN_STARTED:
			return _StartRun(state, event.runId);
		case EventType.RUN_FINISHED:
			return _FinishRun(state, event);
		case EventType.RUN_ERROR:
			return _FailRun(state, event.message, event.code);
		case EventType.TEXT_MESSAGE_START:
			return _StartMessage(state, event.messageId, event.role);
		case EventType.TEXT_MESSAGE_CONTENT:
			return _AppendMessage(state, event.messageId, event.delta);
		case EventType.TEXT_MESSAGE_END:
			return _CompleteMessage(state, event.messageId);
		case EventType.TOOL_CALL_START:
			return _StartTool(state, event.toolCallId, event.toolCallName);
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

/** Handle OpenCrane's own CUSTOM events; unrecognised names are recorded by name only, never by payload. */
function _Custom(state: AgUiStreamState, name: string, value: unknown): AgUiStreamState
{
	if (name === "opencrane.access_revoked") return __RevokeAgUiStreamAccess();
	if (name === AG_UI_INTERRUPTS_CLEARED_EVENT) return { ...state, interrupts: [], customEvents: [...state.customEvents, name] };
	if (name === "opencrane.message_terminal") return _MessageTerminal(state, value, name);
	if (name === AG_UI_TOOL_FAILURE_EVENT) return _ToolFailure(state, value, name);
	if (name === AG_UI_TOOL_RECOVERY_REQUIRED_EVENT) return _ToolRecoveryRequired(state, value, name);
	if (name === AG_UI_A2UI_ENVELOPE_VERSION) return _A2uiSurface(state, ___ParseAgUiA2uiEnvelope(value), name);
	if (name === AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT) return _AgentThreadParentDelivery(state, value, name);
	return { ...state, customEvents: [...state.customEvents, name] };
}
