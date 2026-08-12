import type { CustomEvent, Interrupt, RunErrorEvent, RunFinishedEvent, RunStartedEvent, TextMessageContentEvent, TextMessageEndEvent, TextMessageStartEvent, ToolCallArgsEvent, ToolCallEndEvent, ToolCallResultEvent, ToolCallStartEvent } from "@ag-ui/core";
import type { BeginRenderingMessage, DataModelUpdate, SurfaceUpdateMessage } from "@a2ui/web_core/v0_8";

import type { RunEventType } from "@opencrane/models/agents";
import type { ConversationId } from "@opencrane/models/conversations";

/** Version of OpenCrane's intentionally small AG-UI event projection. */
export const AG_UI_PROJECTION_VERSION = "opencrane.ag-ui.v1";

/** Version of the governed A2UI payload carried inside an AG-UI CUSTOM event. */
export const AG_UI_A2UI_ENVELOPE_VERSION = "opencrane.a2ui.v1";

/** Version of the lossy governed-child update carried inside a parent run stream. */
export const AG_UI_CHILD_RUN_ENVELOPE_VERSION = "opencrane.child_run.v1";

/** Cursorless custom marker that authoritatively clears the current open-interrupt overlay. */
export const AG_UI_INTERRUPTS_CLEARED_EVENT = "opencrane.interrupts_cleared";

/** Display-safe custom marker for one canonical tool failure that may precede later model work. */
export const AG_UI_TOOL_FAILURE_EVENT = "opencrane.tool_failed";

/** Display-safe custom marker for a cancellable run whose provider outcome needs recovery. */
export const AG_UI_TOOL_RECOVERY_REQUIRED_EVENT = "opencrane.tool_recovery_required";

/**
 * Authoritative browser presentation lifecycle for one governed A2UI surface.
 *
 * These serialized values describe display state only. They never authorize an action, infer a
 * canonical run transition, or let the browser select the next state.
 */
export enum AgUiA2uiSurfaceStates
{
	/** Ordered surface operations are still arriving. */
	Streaming = "streaming",
	/** The authoritative projection declares the surface ready for a displayed action. */
	Ready = "ready",
	/** One displayed action awaits authoritative server admission. */
	ActionPending = "action_pending",
	/** The authoritative server accepted the displayed action. */
	Submitted = "submitted",
	/** The server rejected submitted values as invalid. */
	ValidationError = "validation_error",
	/** The authoritative action path failed without claiming success. */
	ActionFailed = "action_failed",
	/** The server-declared action window expired. */
	Expired = "expired",
	/** The one-use action was already consumed. */
	AlreadyUsed = "already_used",
	/** The current actor is not authorized to use the displayed action. */
	Unauthorized = "unauthorized",
	/** The admitted surface cannot be rendered by this client. */
	Unsupported = "unsupported",
}

/** One strictly admitted A2UI surface operation. */
export type AgUiA2uiOperation = { readonly beginRendering: BeginRenderingMessage } | { readonly surfaceUpdate: SurfaceUpdateMessage } | { readonly dataModelUpdate: DataModelUpdate };

/** Browser-safe A2UI projection. It carries presentation coordinates, never action authority. */
export interface AgUiA2uiEnvelope
{
	readonly version: typeof AG_UI_A2UI_ENVELOPE_VERSION;
	readonly conversationId: string;
	readonly runId: string;
	readonly messageId: string;
	readonly surfaceId: string;
	readonly sequence: number;
	readonly state: AgUiA2uiSurfaceStates;
	readonly operations: readonly AgUiA2uiOperation[];
	readonly reason?: string;
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

/** Display-safe technical classification for one failed tool call. */
export interface AgUiToolFailureEnvelope
{
	/** Canonical source event name; it carries no action or retry authority. */
	readonly eventType: "tool.failed";
	/** Stable public tool-call coordinate already introduced by TOOL_CALL_START. */
	readonly toolCallId: string;
	/** Optional server-selected classification from the fixed safe vocabulary. */
	readonly failureCode?: string;
}

/** Fixed safe causes a provider effect can remain unresolved after dispatch began. */
export enum AgUiToolRecoveryProviderOutcomes
{
	/** Dispatch began but no trusted success or failure acknowledgement survived. */
	UnknownAfterDispatch = "unknown_after_dispatch",
	/** A dispatch claim expired after provider dispatch may have begun. */
	ClaimLeaseExpired = "claim_lease_expired",
	/** Trusted provider readback could not establish a terminal outcome. */
	ReconciliationInconclusive = "reconciliation_inconclusive",
}

/** Exact browser-safe projection of one durable manual-recovery requirement. */
export interface AgUiToolRecoveryRequiredEnvelope
{
	/** Canonical source event; this is not a failure, terminal, or elicitation event. */
	readonly eventType: "tool.recovery_required";
	/** Public run coordinate already visible in the conversation stream. */
	readonly runId: string;
	/** Attempt fence a cancellation request must still match. */
	readonly expectedAttempt: number;
	/** Stable public tool-call coordinate already introduced by TOOL_CALL_START. */
	readonly toolCallId: string;
	/** Canonical event instant from the durable run-event row. */
	readonly occurredAt: string;
	/** Fixed user-action category; it grants no retry or provider authority. */
	readonly recoveryCategory: "manual_action_required";
	/** Provider-free preparation attempts consumed before dispatch began. */
	readonly preparationRetryCount: number;
	/** Fixed provider-free preparation attempt limit. */
	readonly preparationRetryLimit: 3;
	/** Optional fixed classification of the ambiguous provider outcome. */
	readonly providerOutcome?: AgUiToolRecoveryProviderOutcomes;
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
	readonly toolRecovery?: Omit<AgUiToolRecoveryRequiredEnvelope, "runId" | "occurredAt">;
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
