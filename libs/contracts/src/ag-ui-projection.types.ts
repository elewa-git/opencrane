import type { CustomEvent, Interrupt, RunErrorEvent, RunFinishedEvent, RunStartedEvent, TextMessageContentEvent, TextMessageEndEvent, TextMessageStartEvent, ToolCallArgsEvent, ToolCallEndEvent, ToolCallResultEvent, ToolCallStartEvent } from "@ag-ui/core";
import type { DataModelUpdate, SurfaceUpdateMessage } from "@a2ui/web_core/v0_8";

import type { RunEventType } from "@opencrane/models/agents";
import type { ConversationId } from "@opencrane/models/conversations";

/** Exact AG-UI package release supported by this projection. */
export const AG_UI_PROTOCOL_VERSION = "0.0.57";

/** Version of OpenCrane's intentionally small AG-UI event projection. */
export const AG_UI_PROJECTION_VERSION = "opencrane.ag-ui.v1";

/** Version of the governed A2UI payload carried inside an AG-UI CUSTOM event. */
export const AG_UI_A2UI_ENVELOPE_VERSION = "opencrane.a2ui.v1";

/** Version of the lossy governed-child update carried inside a parent run stream. */
export const AG_UI_CHILD_RUN_ENVELOPE_VERSION = "opencrane.child_run.v1";

/** One strictly admitted A2UI surface operation. */
export type AgUiA2uiOperation = { readonly surfaceUpdate: SurfaceUpdateMessage } | { readonly dataModelUpdate: DataModelUpdate };

/** Browser-safe A2UI projection. It carries presentation coordinates, never action authority. */
export interface AgUiA2uiEnvelope
{
	readonly version: typeof AG_UI_A2UI_ENVELOPE_VERSION;
	readonly conversationId: string;
	readonly runId: string;
	readonly messageId: string;
	readonly surfaceId: string;
	readonly sequence: number;
	readonly operations: readonly AgUiA2uiOperation[];
}

/** Terminal state of one governed child as observed by its immediate parent. */
export type AgUiChildRunState = "completed" | "failed" | "cancelled";

/** Lossy child update that deliberately excludes child context and sibling data. */
export interface AgUiChildRunEnvelope
{
	readonly version: typeof AG_UI_CHILD_RUN_ENVELOPE_VERSION;
	readonly parentRunId: string;
	readonly childRunId: string;
	readonly attempt: number;
	readonly state: AgUiChildRunState;
	readonly terminalReason?: string;
	readonly finishedAt: string;
}

/** Safe, user-facing fragments selected by the server-owned event reader. */
export interface AgUiPublicEventPayload
{
	readonly messageId?: string;
	readonly messageRole?: "assistant" | "user" | "system" | "tool";
	readonly messageState?: "pending" | "streaming" | "completed" | "failed" | "cancelled";
	readonly messageText?: string;
	readonly delta?: string;
	readonly toolCallId?: string;
	readonly toolCallName?: string;
	readonly toolResult?: string;
	readonly terminalReason?: string;
	readonly failureCode?: string;
	readonly interrupt?: Interrupt;
	readonly a2ui?: AgUiA2uiEnvelope;
	readonly childRun?: AgUiChildRunEnvelope;
}

/** One already-authorized canonical event made safe for protocol projection. */
export interface AgUiProjectionSourceEvent
{
	/** Durable cursor selected by the server-owned replay reader; overlays intentionally omit it. */
	readonly cursor?: string;
	readonly conversationId: ConversationId;
	readonly runId?: string;
	readonly position: string;
	readonly eventType: RunEventType | (string & {});
	readonly occurredAt: string;
	readonly payload: AgUiPublicEventPayload;
}

/** Standard events admitted by OpenCrane from the exact-pinned upstream vocabulary. */
export type AgUiProjectionEvent = RunStartedEvent | RunFinishedEvent | RunErrorEvent | TextMessageStartEvent | TextMessageContentEvent | TextMessageEndEvent | ToolCallStartEvent | ToolCallArgsEvent | ToolCallEndEvent | ToolCallResultEvent | CustomEvent;

/** One SSE record ready for a server-owned authorized replay source to write. */
export interface AgUiSseRecord
{
	/** Durable cursor. Open-interrupt overlays omit it so Last-Event-ID never advances. */
	readonly id?: string;
	readonly event: "ag-ui";
	readonly data: AgUiProjectionEvent;
}

/** Backward-compatible names now alias the exact upstream AG-UI types. */
export type AgUiRunStartedEvent = RunStartedEvent;
/** Exact upstream run-finished event. */
export type AgUiRunFinishedEvent = RunFinishedEvent;
/** Exact upstream run-error event. */
export type AgUiRunErrorEvent = RunErrorEvent;
/** Exact upstream text-start event. */
export type AgUiTextMessageStartEvent = TextMessageStartEvent;
/** Exact upstream text-content event. */
export type AgUiTextMessageContentEvent = TextMessageContentEvent;
/** Exact upstream text-end event. */
export type AgUiTextMessageEndEvent = TextMessageEndEvent;
/** Exact upstream tool-call-start event. */
export type AgUiToolCallStartEvent = ToolCallStartEvent;
/** Exact upstream tool-call-arguments event. */
export type AgUiToolCallArgsEvent = ToolCallArgsEvent;
/** Exact upstream tool-call-end event. */
export type AgUiToolCallEndEvent = ToolCallEndEvent;
/** Exact upstream tool-result event. */
export type AgUiToolCallResultEvent = ToolCallResultEvent;
/** Exact upstream custom event. */
export type AgUiCustomEvent = CustomEvent;
