import type { RunEventType } from "@opencrane/models/agents";

/** Version of OpenCrane's intentionally small AG-UI event projection. */
export const AG_UI_PROJECTION_VERSION = "opencrane.ag-ui.v1";

/** Safe, user-facing fragments selected by the server-owned event reader. */
export interface AgUiPublicEventPayload
{
	/** Assistant message identifier, when the canonical event addresses one. */
	readonly messageId?: string;
	/** Assistant text delta, when the canonical event exposes one for this audience. */
	readonly delta?: string;
	/** Tool-call identifier, when the canonical event addresses one. */
	readonly toolCallId?: string;
	/** Display-safe tool name, when the canonical event exposes one. */
	readonly toolCallName?: string;
	/** Display-safe, already-redacted tool result text. */
	readonly toolResult?: string;
}

/** One already-authorized canonical event made safe for protocol projection. */
export interface AgUiProjectionSourceEvent
{
	/** Durable cursor selected by the server-owned replay reader. */
	readonly cursor: string;
	/** Thread selected by the authorized server-side replay reader. */
	readonly threadId: string;
	/** Run that owns the canonical event. */
	readonly runId: string;
	/** Monotonic canonical sequence used only for deterministic mapping. */
	readonly sequence: number;
	/** Canonical event vocabulary, retaining unknown strings for fail-safe rendering. */
	readonly eventType: RunEventType | (string & {});
	/** ISO-8601 time at which the canonical event occurred. */
	readonly occurredAt: string;
	/** Explicitly selected safe payload fields; raw canonical payloads never cross this contract. */
	readonly payload: AgUiPublicEventPayload;
}

/** Minimal standard AG-UI run-start event. */
export interface AgUiRunStartedEvent
{
	/** AG-UI discriminator. */
	readonly type: "RUN_STARTED";
	/** Thread represented by this stream. */
	readonly threadId: string;
	/** Run represented by this event. */
	readonly runId: string;
}

/** Minimal standard AG-UI run-finished event. */
export interface AgUiRunFinishedEvent
{
	/** AG-UI discriminator. */
	readonly type: "RUN_FINISHED";
	/** Thread represented by this stream. */
	readonly threadId: string;
	/** Run represented by this event. */
	readonly runId: string;
}

/** Minimal standard AG-UI text-message start event. */
export interface AgUiTextMessageStartEvent
{
	/** AG-UI discriminator. */
	readonly type: "TEXT_MESSAGE_START";
	/** Message being assembled. */
	readonly messageId: string;
	/** Assistant role for canonical model-output messages. */
	readonly role: "assistant";
}

/** Minimal standard AG-UI text-message delta event. */
export interface AgUiTextMessageContentEvent
{
	/** AG-UI discriminator. */
	readonly type: "TEXT_MESSAGE_CONTENT";
	/** Message being assembled. */
	readonly messageId: string;
	/** Display-safe text delta. */
	readonly delta: string;
}

/** Minimal standard AG-UI text-message completion event. */
export interface AgUiTextMessageEndEvent
{
	/** AG-UI discriminator. */
	readonly type: "TEXT_MESSAGE_END";
	/** Message that is no longer streaming. */
	readonly messageId: string;
}

/** Minimal standard AG-UI tool-call start event. */
export interface AgUiToolCallStartEvent
{
	/** AG-UI discriminator. */
	readonly type: "TOOL_CALL_START";
	/** Tool call being assembled. */
	readonly toolCallId: string;
	/** Display-safe tool name. */
	readonly toolCallName: string;
}

/** Minimal standard AG-UI tool-call argument delta event. */
export interface AgUiToolCallArgsEvent
{
	/** AG-UI discriminator. */
	readonly type: "TOOL_CALL_ARGS";
	/** Tool call being assembled. */
	readonly toolCallId: string;
	/** Display-safe argument delta. */
	readonly delta: string;
}

/** Minimal standard AG-UI tool-call completion event. */
export interface AgUiToolCallEndEvent
{
	/** AG-UI discriminator. */
	readonly type: "TOOL_CALL_END";
	/** Tool call that is no longer streaming. */
	readonly toolCallId: string;
}

/** Minimal standard AG-UI tool-result event. */
export interface AgUiToolCallResultEvent
{
	/** AG-UI discriminator. */
	readonly type: "TOOL_CALL_RESULT";
	/** Tool call producing the result. */
	readonly toolCallId: string;
	/** Display-safe tool result text. */
	readonly content: string;
}

/** Vendor-namespaced signal for an event that has no stable standard mapping yet. */
export interface AgUiCustomEvent
{
	/** AG-UI discriminator. */
	readonly type: "CUSTOM";
	/** OpenCrane event name that clients may display but must not treat as a command. */
	readonly name: string;
	/** Non-sensitive canonical classification only. */
	readonly value: { readonly eventType: string };
}

/** One protocol event the offline projection can encode without an AG-UI runtime dependency. */
export type AgUiProjectionEvent = AgUiRunStartedEvent | AgUiRunFinishedEvent | AgUiTextMessageStartEvent | AgUiTextMessageContentEvent | AgUiTextMessageEndEvent | AgUiToolCallStartEvent | AgUiToolCallArgsEvent | AgUiToolCallEndEvent | AgUiToolCallResultEvent | AgUiCustomEvent;

/** One SSE record ready for a server-owned authorized replay source to write. */
export interface AgUiSseRecord
{
	/** Durable canonical cursor used as the SSE event identifier. */
	readonly id: string;
	/** Fixed event name that distinguishes this versioned projection from canonical SSE. */
	readonly event: "ag-ui";
	/** Versioned, display-safe AG-UI event. */
	readonly data: AgUiProjectionEvent;
}
