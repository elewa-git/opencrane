import { EventType } from "@ag-ui/core";
import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT, AG_UI_INTERRUPTS_CLEARED_EVENT, AG_UI_TOOL_FAILURE_EVENT, AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, AgentThreadDeliveryKinds, AgUiToolRecoveryProviderOutcomes, ___ParseAgUiA2uiEnvelope, type AgUiA2uiEnvelope, type AgUiProjectionEvent, type AgUiToolFailureEnvelope, type AgUiToolRecoveryRequiredEnvelope } from "@opencrane/contracts";

import { AgUiMessageStatuses, AgUiRunStatuses, AgUiToolStatuses, type AgUiAgentThreadParentDelivery, type AgUiMessageView, type AgUiStreamRecord, type AgUiStreamState } from "./ag-ui-stream.types.js";

/** Most operations kept for one surface; a surface that exceeds this makes the reducer throw. */
const _MAX_MATERIALIZED_A2UI_OPERATIONS = 256;

/** The provider outcomes a recovery event may carry; anything else is rejected. */
const _TOOL_RECOVERY_PROVIDER_OUTCOMES = new Set<string>(Object.values(AgUiToolRecoveryProviderOutcomes));

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
 * Called by: OpenCraneConversationEventStream (state/conversation/adapter) on a 403, and reached
 * from within the reducer when the server sends the "opencrane.access_revoked" custom event.
 *
 * @returns Empty state marked as revoked. Do not keep reducing into the previous state after this.
 */
export function __RevokeAgUiStreamAccess(): AgUiStreamState
{
	return { ...__CreateAgUiStreamState(), accessRevoked: true, customEvents: ["opencrane.access_revoked"] };
}

/**
 * Folds one decoded SSE record into the stream state, returning new state.
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
 * @param record - One decoded record from {@link __DecodeAgUiSseRecord}.
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
 * Returns the cursor a reconnecting request must send, or undefined to start from the beginning.
 *
 * Undefined is normal, not an error: it means no record with a cursor has been accepted yet, so
 * there is nothing to resume from. The caller sends the value as both the `cursor` query parameter
 * and the `Last-Event-ID` header.
 *
 * Called by: OpenCraneConversationEventStream (state/conversation/adapter) before each request.
 *
 * @param state - Current stream state.
 * @returns The cursor to resume from, or `undefined` meaning request the stream from its start.
 */
export function __AgUiResumeCursor(state: AgUiStreamState): string | undefined { return state.cursor ?? undefined; }

/** Apply one event; the caller has already checked the transport framing and rejected duplicates. */
function _ReduceEvent(state: AgUiStreamState, event: AgUiProjectionEvent): AgUiStreamState
{
	switch (event.type)
	{
		case EventType.RUN_STARTED:
			return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Running, runFailure: null, runRecovery: null, interrupts: [], accessRevoked: false };
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
			return { ...state, tools: { ...state.tools, [event.toolCallId]: { id: event.toolCallId, name: event.toolCallName, arguments: "", status: AgUiToolStatuses.Requested, result: null, failureCode: null, failures: [], recovery: null } } };
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

/** Mark the run failed, or cancelled when the code is RUN_CANCELLED, keeping only the message and code. */
function _FailRun(state: AgUiStreamState, message: string, code: string | undefined): AgUiStreamState
{
	const runStatus = code === "RUN_CANCELLED" ? AgUiRunStatuses.Cancelled : AgUiRunStatuses.Failed;
	return { ...state, runStatus, runFailure: { message, ...(code === undefined ? {} : { code }) }, interrupts: [] };
}

/** Finish the run as succeeded, or interrupted when the outcome asks for input; never overwrite a failure. */
function _FinishRun(state: AgUiStreamState, event: Extract<AgUiProjectionEvent, { readonly type: EventType.RUN_FINISHED }>): AgUiStreamState
{
	if (state.runId !== null && state.runId !== event.runId) throw new Error("AG-UI run terminal does not match the active run");
	if (state.runStatus === AgUiRunStatuses.NeedsRecovery || state.runStatus === AgUiRunStatuses.Failed || state.runStatus === AgUiRunStatuses.Cancelled) throw new Error("AG-UI success cannot overwrite a recovery-required, failed, or cancelled run");
	if (event.outcome?.type === "interrupt") return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Interrupted, runFailure: null, interrupts: event.outcome.interrupts };
	return { ...state, runId: event.runId, runStatus: AgUiRunStatuses.Succeeded, runFailure: null, interrupts: [] };
}

/** Add text to a streaming message; throws when no start frame has created it yet. */
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

/** Mark a known tool call complete, or Recovered if it failed earlier; leave it alone if recovery is still open. */
function _CompleteTool(state: AgUiStreamState, toolCallId: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool end has no active tool call");
	if (tool.status === AgUiToolStatuses.NeedsRecovery || tool.recovery !== null) return state;
	const status = tool.failures.length === 0 && tool.recovery === null ? AgUiToolStatuses.Completed : AgUiToolStatuses.Recovered;
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, status } } };
}

/** Attach the result to a known tool call, unless it is still waiting on recovery. */
function _ResultTool(state: AgUiStreamState, toolCallId: string, content: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool result has no known tool call");
	if (tool.status === AgUiToolStatuses.NeedsRecovery || tool.recovery !== null) return state;
	const status = tool.failures.length === 0 && tool.recovery === null ? AgUiToolStatuses.Completed : AgUiToolStatuses.Recovered;
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, status, result: content } } };
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

/** Adopt one exact display-safe immediate-parent delivery; runtime authority fields are rejected. */
function _AgentThreadParentDelivery(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsAgentThreadParentDelivery(value)) throw new Error("AG-UI Agent-thread parent delivery is invalid");
	const existing = state.agentThreadParentDeliveries[value.id];
	if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error("AG-UI Agent-thread parent delivery changed payload");
	if (existing !== undefined) return state;
	return { ...state, agentThreadParentDeliveries: { ...state.agentThreadParentDeliveries, [value.id]: value }, customEvents: [...state.customEvents, name] };
}

/** Validate exact bounded display fields and reject every unexpected authority or provider field. */
function _IsAgentThreadParentDelivery(value: unknown): value is AgUiAgentThreadParentDelivery
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const keys = ["id", "childConversationId", "kind", "label", "detail", "assetId"];
	if (Object.keys(candidate).length !== keys.length || keys.some(function _Missing(key) { return !Object.hasOwn(candidate, key); })) return false;
	if (!_BoundedIdentifier(candidate["id"]) || !_BoundedIdentifier(candidate["childConversationId"])) return false;
	if (typeof candidate["kind"] !== "string" || !Object.values(AgentThreadDeliveryKinds).includes(candidate["kind"] as AgentThreadDeliveryKinds)) return false;
	if (typeof candidate["label"] !== "string" || candidate["label"].trim().length === 0 || candidate["label"].length > 160) return false;
	if (typeof candidate["detail"] !== "string" || candidate["detail"].trim().length === 0 || candidate["detail"].length > 4000) return false;
	return candidate["assetId"] === null || _BoundedIdentifier(candidate["assetId"]);
}

/** Stop the run and mark it NeedsRecovery, so an unclear provider outcome is shown as neither a failure nor a request for input. */
function _ToolRecoveryRequired(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsToolRecoveryRequired(value)) throw new Error("AG-UI tool recovery requirement is invalid");
	if (state.runId === null || value.runId !== state.runId) throw new Error("AG-UI tool recovery requirement does not match the active run");
	if (state.runStatus !== AgUiRunStatuses.Running && state.runStatus !== AgUiRunStatuses.Interrupted) throw new Error("AG-UI tool recovery requirement has no recoverable active run");
	const tool = state.tools[value.toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool recovery requirement has no known tool call");
	const recoveryTool = { ...tool, status: AgUiToolStatuses.NeedsRecovery, recovery: value };
	return { ...state, runStatus: AgUiRunStatuses.NeedsRecovery, runFailure: null, runRecovery: value, interrupts: [], tools: { ...state.tools, [value.toolCallId]: recoveryTool }, customEvents: [...state.customEvents, name] };
}

/** Whether a CUSTOM payload is a valid recovery envelope: exact key set, bounded ids, and a known provider outcome. */
function _IsToolRecoveryRequired(value: unknown): value is AgUiToolRecoveryRequiredEnvelope
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	const required = ["eventType", "runId", "expectedAttempt", "toolCallId", "occurredAt", "recoveryCategory", "preparationRetryCount", "preparationRetryLimit"];
	if (required.some(function _Missing(key): boolean { return !Object.hasOwn(candidate, key); })) return false;
	if (keys.some(function _Unknown(key): boolean { return !required.includes(key) && key !== "providerOutcome"; })) return false;
	if (candidate["eventType"] !== "tool.recovery_required" || candidate["recoveryCategory"] !== "manual_action_required") return false;
	if (!_BoundedIdentifier(candidate["runId"]) || !_BoundedIdentifier(candidate["toolCallId"])) return false;
	if (!Number.isSafeInteger(candidate["expectedAttempt"]) || (candidate["expectedAttempt"] as number) < 1) return false;
	if (!Number.isSafeInteger(candidate["preparationRetryCount"]) || (candidate["preparationRetryCount"] as number) < 0 || (candidate["preparationRetryCount"] as number) > 3) return false;
	if (candidate["preparationRetryLimit"] !== 3 || !_CanonicalInstant(candidate["occurredAt"])) return false;
	return candidate["providerOutcome"] === undefined || (typeof candidate["providerOutcome"] === "string" && _TOOL_RECOVERY_PROVIDER_OUTCOMES.has(candidate["providerOutcome"]));
}

/** Whether a value is a non-empty string of at most 256 characters. */
function _BoundedIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256;
}

/** Whether a value is an ISO-8601 UTC timestamp that round-trips exactly through Date.toISOString(). */
function _CanonicalInstant(value: unknown): value is string
{
	if (typeof value !== "string") return false;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

/** Mark a known tool call failed, keeping only the failure code the server chose. */
function _ToolFailure(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsToolFailure(value)) throw new Error("AG-UI tool failure is invalid");
	const tool = state.tools[value.toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool failure has no known tool call");
	const failureCode = value.failureCode ?? null;
	const failed = { ...tool, status: AgUiToolStatuses.Failed, failureCode, failures: [...tool.failures, { code: failureCode, retrying: value.retrying, technicalDetails: value.technicalDetails }] };
	return { ...state, tools: { ...state.tools, [value.toolCallId]: failed }, customEvents: [...state.customEvents, name] };
}

/** Whether a CUSTOM payload is a valid tool-failure envelope: no unexpected keys, and the exact eventType. */
function _IsToolFailure(value: unknown): value is AgUiToolFailureEnvelope
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (keys.some(function _Unknown(key): boolean { return key !== "eventType" && key !== "toolCallId" && key !== "failureCode" && key !== "retrying" && key !== "technicalDetails"; })) return false;
	return candidate["eventType"] === "tool.failed" && _BoundedIdentifier(candidate["toolCallId"]) && (candidate["failureCode"] === undefined || typeof candidate["failureCode"] === "string") && typeof candidate["retrying"] === "boolean" && _IsSafeToolTechnicalDetails(candidate["technicalDetails"]);
}

/** Admit only the exact progressive-disclosure fields selected by the server. */
function _IsSafeToolTechnicalDetails(value: unknown): value is AgUiToolFailureEnvelope["technicalDetails"]
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const required = ["toolIdentifier", "toolRevision", "occurredAt", "retryCount", "retryLimit"];
	const optional = ["externalSystem", "failureCategory", "providerCode", "httpStatus", "summary"];
	if (required.some(function _Missing(key) { return !Object.hasOwn(candidate, key); }) || Object.keys(candidate).some(function _Unknown(key) { return !required.includes(key) && !optional.includes(key); })) return false;
	if (!_BoundedIdentifier(candidate["toolIdentifier"]) || !_BoundedIdentifier(candidate["toolRevision"]) || !_CanonicalInstant(candidate["occurredAt"])) return false;
	if (!Number.isSafeInteger(candidate["retryCount"]) || (candidate["retryCount"] as number) < 0 || candidate["retryLimit"] !== 3 || (candidate["retryCount"] as number) > 3) return false;
	if (candidate["httpStatus"] !== undefined && (!Number.isSafeInteger(candidate["httpStatus"]) || (candidate["httpStatus"] as number) < 100 || (candidate["httpStatus"] as number) > 599)) return false;
	return optional.filter(function _StringField(key) { return key !== "httpStatus"; }).every(function _BoundedOptional(key) { const field = candidate[key]; return field === undefined || _BoundedIdentifier(field); });
}

/**
 * Accepts one A2UI surface envelope, keyed by the four ids that identify the surface.
 *
 * Operations accumulate: a new envelope's operations are appended to what is already stored, so a
 * surface builds up as it streams. The sequence must advance by exactly one — going backwards,
 * skipping, or exceeding {@link _MAX_MATERIALIZED_A2UI_OPERATIONS} all throw. Re-sending the same
 * sequence is accepted only when the payload is byte-identical; a changed payload at the same
 * sequence throws, which is what `surfaceFingerprints` exists to detect.
 */
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

/** Build the map key for a surface from its conversation, run, message and surface ids. */
function _A2uiSurfaceIdentity(envelope: AgUiA2uiEnvelope): string
{
	return JSON.stringify([envelope.conversationId, envelope.runId, envelope.messageId, envelope.surfaceId]);
}

/** Apply the marker that ends a message as failed or cancelled. */
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
